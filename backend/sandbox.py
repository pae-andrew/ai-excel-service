"""Run model-generated pandas code against a DataFrame in a subprocess."""
import os
import sys
import json
import pickle
import tempfile
import subprocess

_RUNNER = os.path.join(os.path.dirname(__file__), "_runner.py")
TIMEOUT_S = 15


def run(df, code: str):
    """Exec `code` with `df`/`pd`/`np` in scope. Returns (new_df, stdout, error)."""
    with tempfile.TemporaryDirectory() as d:
        in_p = os.path.join(d, "in.pkl")
        out_p = os.path.join(d, "out.pkl")
        code_p = os.path.join(d, "code.py")
        with open(in_p, "wb") as f:
            pickle.dump(df, f)
        with open(code_p, "w") as f:
            f.write(code)

        try:
            proc = subprocess.run(
                [sys.executable, _RUNNER, in_p, code_p, out_p],
                capture_output=True, text=True, timeout=TIMEOUT_S,
                cwd=d, env={"PATH": os.environ.get("PATH", "")},
            )
        except subprocess.TimeoutExpired:
            return df, "", f"execution timed out after {TIMEOUT_S}s"

        if proc.returncode != 0:
            # Hard crash (e.g. rlimit kill) — stderr has the cause.
            return df, "", (proc.stderr or "subprocess failed")[:2000]

        try:
            meta = json.loads(proc.stdout)
        except json.JSONDecodeError:
            return df, "", (proc.stdout or proc.stderr)[:2000]

        new_df = df
        if os.path.exists(out_p):
            with open(out_p, "rb") as f:
                new_df = pickle.load(f)
        return new_df, meta.get("stdout", ""), meta.get("error")
