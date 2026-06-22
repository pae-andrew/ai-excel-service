"""Subprocess runner: exec model-generated code against a DataFrame in isolation.

Invoked as:  python _runner.py <in_pickle> <code_file> <out_pickle>
Reads df from in_pickle, execs code (var `df` in scope), writes resulting df to
out_pickle. Prints a JSON line {stdout, error} to its own stdout.

ponytail: isolation = import whitelist + rlimits + timeout (set by parent).
Whitelist blocks os/sys/subprocess/socket, so no shell, no filesystem walk, no
network. Not a true sandbox — for untrusted multi-tenant prod replace with a
per-request container (gVisor/Firecracker).
"""
import sys
import io
import json
import pickle
import builtins

ALLOWED_IMPORTS = {
    "pandas", "numpy", "math", "statistics", "datetime", "re", "json",
    "collections", "itertools", "functools", "decimal", "openpyxl",
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
        # 512 MB address space, 10s CPU. Best-effort; not available on all OSes.
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024,) * 2)
        resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    except Exception:
        pass


def main():
    in_pickle, code_file, out_pickle = sys.argv[1], sys.argv[2], sys.argv[3]
    _limit_resources()

    with open(in_pickle, "rb") as f:
        df = pickle.load(f)
    with open(code_file, "r") as f:
        code = f.read()

    import pandas as pd
    import numpy as np

    # Reduced builtins: drop open/exec/eval/compile/input. Keep the rest usable.
    safe_builtins = {
        k: getattr(builtins, k)
        for k in dir(builtins)
        if k not in {"open", "exec", "eval", "compile", "input", "__import__", "help"}
    }
    safe_builtins["__import__"] = _guarded_import

    env = {"__builtins__": safe_builtins, "pd": pd, "np": np, "df": df}

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

    df = env.get("df", df)
    with open(out_pickle, "wb") as f:
        pickle.dump(df, f)

    real_stdout.write(json.dumps({"stdout": out.getvalue()[:8000], "error": err}))


if __name__ == "__main__":
    main()
