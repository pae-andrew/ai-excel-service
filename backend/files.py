"""Read/write spreadsheets and a TTL temp store for results to download."""
import io
import time
import uuid
import threading
import pandas as pd

MAX_BYTES = 25 * 1024 * 1024
TTL_S = 15 * 60

_store: dict[str, tuple[float, bytes, str]] = {}  # id -> (expires_at, data, filename)
_sessions: dict[str, tuple[float, object]] = {}   # session_id -> (expires_at, df)
_lock = threading.Lock()


def session_put(sid: str, df) -> None:
    with _lock:
        _sessions[sid] = (time.time() + TTL_S, df)


def session_get(sid: str):
    now = time.time()
    with _lock:
        item = _sessions.get(sid)
        if not item or item[0] < now:
            _sessions.pop(sid, None)
            return None
        return item[1]


def read_to_df(data: bytes, filename: str) -> pd.DataFrame:
    if len(data) > MAX_BYTES:
        raise ValueError(f"file too large (> {MAX_BYTES // 1024 // 1024} MB)")
    name = (filename or "").lower()
    bio = io.BytesIO(data)
    if name.endswith(".csv"):
        return pd.read_csv(bio)
    if name.endswith((".xlsx", ".xlsm", ".xls")):
        return pd.read_excel(bio, engine="openpyxl")
    raise ValueError("unsupported file type (use .xlsx or .csv)")


def df_to_xlsx_bytes(df: pd.DataFrame) -> bytes:
    bio = io.BytesIO()
    with pd.ExcelWriter(bio, engine="openpyxl") as w:
        df.to_excel(w, index=False, sheet_name="Result")
    return bio.getvalue()


def schema_markdown(df: pd.DataFrame) -> str:
    dtypes = "\n".join(f"- {c}: {t}" for c, t in df.dtypes.astype(str).items())
    return (
        f"Rows: {len(df)}, Columns: {len(df.columns)}\n\n"
        f"Columns:\n{dtypes}\n\nPreview (df.head()):\n{df.head().to_string()}"
    )


def stash(data: bytes, filename: str) -> str:
    _gc()
    did = uuid.uuid4().hex
    with _lock:
        _store[did] = (time.time() + TTL_S, data, filename)
    return did


def fetch(did: str):
    _gc()
    with _lock:
        item = _store.get(did)
    if not item:
        return None
    _, data, filename = item
    return data, filename


def _gc():
    now = time.time()
    with _lock:
        for k in [k for k, (exp, *_) in _store.items() if exp < now]:
            del _store[k]
