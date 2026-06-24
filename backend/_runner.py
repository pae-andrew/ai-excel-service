"""Subprocess runner: exec model-generated code against a DataFrame in isolation.

Invoked as:  python _runner.py <in_pickle> <code_file> <out_pickle>
Reads df from in_pickle, execs code (var `df` in scope), writes resulting df to
out_pickle. Prints a JSON line {stdout, error} to its own stdout.

ponytail: isolation = import whitelist + rlimits + timeout (set by parent).
Whitelist blocks os/sys/subprocess/socket, so no shell, no filesystem walk, no
network. Not a true sandbox — for untrusted multi-tenant prod replace with a
per-request container (gVisor/Firecracker).
"""
import os
import sys
import io
import json
import pickle
import builtins

ALLOWED_IMPORTS = {
    "pandas", "numpy", "math", "statistics", "datetime", "re", "json",
    "collections", "itertools", "functools", "decimal", "openpyxl",
    # output generation + image handling
    "matplotlib", "docx", "csv", "io", "base64", "textwrap", "PIL",
}


def _guarded_import(name, *args, **kwargs):
    root = name.split(".")[0]
    if root not in ALLOWED_IMPORTS:
        raise ImportError(f"import of '{name}' is blocked in sandbox")
    return _real_import(name, *args, **kwargs)


_real_import = builtins.__import__


def _limit_resources():
    try:
        import resource
        # 10s CPU cap. Best-effort; not available on all OSes.
        # ponytail: no RLIMIT_AS — on Linux it caps *virtual* address space, and
        # numpy/pandas reserve far more than they use, so a low cap kills import.
        # Real memory is bounded by the container limit + the wall-clock timeout.
        resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    except Exception:
        pass


def main():
    in_pickle, code_file, out_pickle = sys.argv[1], sys.argv[2], sys.argv[3]
    _limit_resources()

    with open(in_pickle, "rb") as f:
        payload = pickle.load(f)  # {"sheets": dict, "images": [bytes]}
    sheets = payload["sheets"]
    image_bytes = payload.get("images", [])
    with open(code_file, "r") as f:
        code = f.read()

    active = next(iter(sheets), None)
    df = sheets[active] if active is not None else None

    import pandas as pd
    import numpy as np

    # Reduced builtins: drop exec/eval/compile/input/raw-open. Keep the rest usable.
    safe_builtins = {
        k: getattr(builtins, k)
        for k in dir(builtins)
        if k not in {"open", "exec", "eval", "compile", "input", "__import__", "help"}
    }
    safe_builtins["__import__"] = _guarded_import

    # ponytail: read-only open (python-docx/matplotlib need to read bundled
    # templates/fonts). Write modes stay blocked; with os/subprocess/socket also
    # blocked and the only secret living in env (not a file), read access is low
    # risk here. Harden to a real container sandbox before untrusted multi-tenant.
    _real_open = builtins.open
    _workdir = os.path.realpath(os.getcwd())  # the ephemeral temp dir == HOME/MPLCONFIGDIR

    def _ro_open(file, mode="r", *a, **k):
        if any(c in mode for c in "wax+"):
            # writes allowed only inside the ephemeral work dir (matplotlib font
            # cache, scratch files) — never elsewhere on the filesystem.
            p = os.path.realpath(file)
            if not (p == _workdir or p.startswith(_workdir + os.sep)):
                raise PermissionError("write outside sandbox dir is blocked")
        return _real_open(file, mode, *a, **k)

    safe_builtins["open"] = _ro_open

    outputs = []  # [(filename, bytes)] downloadable result files

    def save_result(filename, data):
        if hasattr(data, "getvalue"):       # io.BytesIO/StringIO
            data = data.getvalue()
        if isinstance(data, str):
            data = data.encode("utf-8")
        outputs.append((str(filename), bytes(data)))

    env = {"__builtins__": safe_builtins, "pd": pd, "np": np, "df": df,
           "sheets": sheets, "save_result": save_result,
           "images": image_bytes, "image": image_bytes[0] if image_bytes else None}

    out = io.StringIO()
    err = None
    real_stdout = sys.stdout
    sys.stdout = out
    try:
        exec(code, env)
    except Exception as e:  # noqa: BLE001 - report any failure back to the model
        err = f"{type(e).__name__}: {e}"
    finally:
        sys.stdout = real_stdout

    # Result = the sheets dict. If the model reassigned `df`, sync it back to the
    # active sheet so the simple "work on df" path keeps working.
    sheets = env.get("sheets", sheets)
    if active is not None and "df" in env and env["df"] is not None:
        sheets[active] = env["df"]
    with open(out_pickle, "wb") as f:
        pickle.dump({"sheets": sheets, "outputs": outputs}, f)

    real_stdout.write(json.dumps({"stdout": out.getvalue()[:8000], "error": err}))


if __name__ == "__main__":
    main()
