"""Export a stashed result file to a new Google Sheet via OAuth 2.0
(server-side, redirect-based — no popups/postMessage needed).

Flow: GET /google/auth -> redirect to Google consent -> GET /google/callback
-> create+fill spreadsheet -> redirect back to the frontend with the sheet URL.

ponytail: `state` carries download_id + return_to as unsigned base64 JSON.
Fine for an MVP (worst case: someone exports a file that's about to expire
anyway, into their own freshly-authorized Google account). Sign/expire it if
this becomes multi-tenant.
"""
import os
import io
import json
import base64
from urllib.parse import urlencode

import pandas as pd
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse, HTMLResponse
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

import files

router = APIRouter()

CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/google/callback")
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def _flow() -> Flow:
    return Flow.from_client_config(
        {"web": {
            "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [REDIRECT_URI],
        }},
        scopes=SCOPES, redirect_uri=REDIRECT_URI,
    )


@router.get("/google/auth")
def google_auth(download_id: str, return_to: str):
    if not (CLIENT_ID and CLIENT_SECRET):
        raise HTTPException(501, "Google OAuth не настроен на сервере (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET)")
    if not files.fetch(download_id):
        raise HTTPException(404, "файл истёк или не найден — сгенерируйте результат заново")
    state = base64.urlsafe_b64encode(json.dumps({"d": download_id, "r": return_to}).encode()).decode()
    url, _ = _flow().authorization_url(access_type="offline", prompt="consent", state=state)
    return RedirectResponse(url)


@router.get("/google/callback")
def google_callback(code: str, state: str):
    payload = json.loads(base64.urlsafe_b64decode(state.encode()))
    download_id, return_to = payload["d"], payload["r"]

    item = files.fetch(download_id)
    if not item:
        return HTMLResponse(
            "<p>Файл истёк (TTL 15 мин). Сгенерируйте результат заново и повторите экспорт.</p>",
            status_code=410,
        )
    data, filename = item

    flow = _flow()
    flow.fetch_token(code=code)
    creds = flow.credentials

    sheets = files.read_to_sheets(data, filename)  # reuse the same xlsx/csv/docx/pdf parser
    title = os.path.splitext(filename)[0] or "Результат"

    service = build("sheets", "v4", credentials=creds)
    spreadsheet = service.spreadsheets().create(body={
        "properties": {"title": title},
        "sheets": [{"properties": {"title": name[:99]}} for name in sheets],
    }).execute()
    sheet_id = spreadsheet["spreadsheetId"]

    value_ranges = []
    for name, df in sheets.items():
        body = df.astype(object).where(df.notna(), "").astype(str)
        values = [list(df.columns)] + body.values.tolist()
        value_ranges.append({"range": f"'{name[:99]}'!A1", "values": values})
    service.spreadsheets().values().batchUpdate(
        spreadsheetId=sheet_id,
        body={"valueInputOption": "RAW", "data": value_ranges},
    ).execute()

    sheet_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit"
    qs = urlencode({"gsheet_url": sheet_url, "gsheet_name": title})
    return RedirectResponse(f"{return_to}?{qs}")
