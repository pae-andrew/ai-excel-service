"""Run model-generated pandas code against a DataFrame in a subprocess."""
import os
import sys
import glob
import json
import pickle
import tempfile
import subprocess

_RUNNER = os.path.join(os.path.dirname(__file__), "_runner.py")
TIMEOUT_S = 30  # PDF/chart generation (matplotlib) needs more headroom than pandas

# Stable matplotlib font cache, built once with a full env (macOS font scan shells
# out to system_profiler, which the stripped sandbox env can't run). Children
# reuse it read-only, so no per-run font scan and no system_profiler call.
_MPL_DIR = os.path.join(tempfile.gettempdir(), "excel_ai_mpl")
_mpl_ready = False


def _ensure_mpl():
    global _mpl_ready
    if _mpl_ready:
        return
    os.makedirs(_MPL_DIR, exist_ok=True)
    if not glob.glob(os.path.join(_MPL_DIR, "fontlist-*.json")):
        env = dict(os.environ)
        env["MPLCONFIGDIR"] = _MPL_DIR
        try:
            subprocess.run(
                [sys.executable, "-c", "import matplotlib;matplotlib.use('Agg');"
                 "import matplotlib.pyplot as plt;plt.subplots()"],
                env=env, capture_output=True, timeout=120,
            )
        except Exception:
            pass  # on failure matplotlib falls back to a per-run scan
    _mpl_ready = True


def run(sheets, code: str):
    """Exec `code` with `sheets`/`df`/`pd`/`np`/`save_result` in scope.
    Returns (new_sheets, outputs, stdout, error). `outputs` = [(filename, bytes)]."""
    _ensure_mpl()
    with tempfile.TemporaryDirectory() as d:
        in_p = os.path.join(d, "in.pkl")
        out_p = os.path.join(d, "out.pkl")
        code_p = os.path.join(d, "code.py")
        with open(in_p, "wb") as f:
            pickle.dump(sheets, f)
        with open(code_p, "w") as f:
            f.write(code)

        # Inherit the OS env (matplotlib's macOS font scan shells out to
        # system_profiler and needs it) but strip the API key, and point HOME /
        # matplotlib cache at the ephemeral temp dir. The model can't reach env
        # vars anyway (os import is blocked), so this is defense-in-depth.
        child_env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
        child_env.update({"HOME": d, "MPLCONFIGDIR": _MPL_DIR})
        try:
            proc = subprocess.run(
                [sys.executable, _RUNNER, in_p, code_p, out_p],
                capture_output=True, text=True, timeout=TIMEOUT_S,
                cwd=d, env=child_env,
            )
        except subprocess.TimeoutExpired:
            return sheets, [], "", f"execution timed out after {TIMEOUT_S}s"

        if proc.returncode != 0:
            # Hard crash (e.g. rlimit kill) — stderr has the cause.
            return sheets, [], "", (proc.stderr or "subprocess failed")[:2000]

        try:
            meta = json.loads(proc.stdout)
        except json.JSONDecodeError:
            return sheets, [], "", (proc.stdout or proc.stderr)[:2000]

        new_sheets, outputs = sheets, []
        if os.path.exists(out_p):
            with open(out_p, "rb") as f:
                result = pickle.load(f)
            new_sheets = result.get("sheets", sheets)
            outputs = result.get("outputs", [])
        return new_sheets, outputs, meta.get("stdout", ""), meta.get("error")
