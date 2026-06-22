"""Read/write spreadsheets (multi-sheet) and a TTL temp store for downloads.

Data model across the app is `sheets`: dict[sheet_name -> DataFrame]. xlsx may
have many sheets; csv/docx/pdf produce one or more tables, each becomes a sheet.
"""
import io
import re
import time
import uuid
import threading
import pandas as pd

MAX_BYTES = 25 * 1024 * 1024
TTL_S = 15 * 60

_store: dict[str, tuple[float, bytes, str]] = {}   # id -> (expires_at, data, filename)
_sessions: dict[str, tuple[float, object]] = {}    # session_id -> (expires_at, sheets)
_lock = threading.Lock()


def _safe_name(name: str, used: set[str]) -> str:
    n = re.sub(r"[\[\]:*?/\\]", "_", str(name))[:31] or "Sheet"
    base, i = n, 1
    while n in used:
        n = f"{base[:28]}_{i}"
        i += 1
    used.add(n)
    return n


def read_to_sheets(data: bytes, filename: str) -> dict[str, pd.DataFrame]:
    if len(data) > MAX_BYTES:
        raise ValueError(f"file too large (> {MAX_BYTES // 1024 // 1024} MB)")
    name = (filename or "").lower()
    bio = io.BytesIO(data)

    if name.endswith(".csv"):
        return {"Sheet1": pd.read_csv(bio)}
    if name.endswith((".xlsx", ".xlsm", ".xls")):
        return pd.read_excel(bio, engine="openpyxl", sheet_name=None)  # all sheets
    if name.endswith(".docx"):
        return _tables_from_docx(bio)
    if name.endswith(".pdf"):
        return _tables_from_pdf(bio)
    raise ValueError("unsupported file type (use .xlsx, .csv, .docx or .pdf)")


def _tables_from_docx(bio: io.BytesIO) -> dict[str, pd.DataFrame]:
    from docx import Document
    doc = Document(bio)
    sheets, used = {}, set()
    for i, t in enumerate(doc.tables):
        rows = [[c.text for c in r.cells] for r in t.rows]
        if not rows:
            continue
        df = pd.DataFrame(rows[1:], columns=rows[0]) if len(rows) > 1 else pd.DataFrame(rows)
        sheets[_safe_name(f"Table{i + 1}", used)] = df
    if not sheets:
        raise ValueError("no tables found in the .docx file")
    return sheets


def _tables_from_pdf(bio: io.BytesIO) -> dict[str, pd.DataFrame]:
    import pdfplumber
    sheets, used = {}, set()
    with pdfplumber.open(bio) as pdf:
        for pi, page in enumerate(pdf.pages):
            for ti, tbl in enumerate(page.extract_tables() or []):
                if not tbl:
                    continue
                df = pd.DataFrame(tbl[1:], columns=tbl[0]) if len(tbl) > 1 else pd.DataFrame(tbl)
                sheets[_safe_name(f"p{pi + 1}_t{ti + 1}", used)] = df
    if not sheets:
        raise ValueError("no tables found in the .pdf file")
    return sheets


def sheets_to_xlsx_bytes(sheets: dict[str, pd.DataFrame]) -> bytes:
    bio = io.BytesIO()
    used = set()
    with pd.ExcelWriter(bio, engine="openpyxl") as w:
        for name, df in sheets.items():
            df.to_excel(w, index=False, sheet_name=_safe_name(name, used))
    return bio.getvalue()


def schema_markdown(sheets: dict[str, pd.DataFrame]) -> str:
    parts = []
    for name, df in sheets.items():
        dtypes = "\n".join(f"  - {c}: {t}" for c, t in df.dtypes.astype(str).items())
        parts.append(
            f"Sheet '{name}' — {len(df)} rows x {len(df.columns)} cols\n"
            f"{dtypes}\n  preview:\n{df.head().to_string()}"
        )
    return f"Sheets: {list(sheets)}\n\n" + "\n\n".join(parts)


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


def session_put(sid: str, sheets) -> None:
    with _lock:
        _sessions[sid] = (time.time() + TTL_S, sheets)


def session_get(sid: str):
    now = time.time()
    with _lock:
        item = _sessions.get(sid)
        if not item or item[0] < now:
            _sessions.pop(sid, None)
            return None
        return item[1]


def _gc():
    now = time.time()
    with _lock:
        for k in [k for k, (exp, *_) in _store.items() if exp < now]:
            del _store[k]
