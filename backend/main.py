"""FastAPI app: /chat (SSE), /download/{id}, /health. Deployed via GitHub Actions."""
import os
import json
import base64
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel

import agent
import files
from google_sheets import router as google_router

app = FastAPI(title="Excel AI assistant")

IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".webp": "image/webp", ".gif": "image/gif"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024
SHARE_TTL_S = 24 * 60 * 60          # read-only chat links outlive the 15-min file/session TTL
MAX_SHARE_BYTES = 2 * 1024 * 1024   # a transcript, not an attachment dump

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("ALLOWED_ORIGIN", "http://localhost:3000")],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(google_router)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/chat")
async def chat(
    session_id: str = Form(...),
    messages: str = Form(...),
    file: list[UploadFile] | None = File(None),
):
    try:
        history = json.loads(messages)
    except json.JSONDecodeError:
        raise HTTPException(400, "messages must be valid JSON")

    uploaded = [f for f in (file or []) if f and f.filename]
    # Split uploads: spreadsheets/docs go to pandas; images go to Claude vision.
    spread_items, images = [], []
    for f in uploaded:
        data = await f.read()
        media = IMAGE_TYPES.get(os.path.splitext(f.filename.lower())[1])
        if media:
            if len(data) > MAX_IMAGE_BYTES:
                raise HTTPException(400, "image too large (> 5 MB)")
            images.append((media, base64.b64encode(data).decode()))
        else:
            spread_items.append((data, f.filename))

    if spread_items:
        try:
            sheets = files.read_files_to_sheets(spread_items)
        except Exception as e:  # parse/validation failures -> 400, not 500
            raise HTTPException(400, str(e))
        files.session_put(session_id, sheets)
    else:
        # No new tabular upload: reuse this session's data, or chat with none.
        sheets = files.session_get(session_id) or {}

    return StreamingResponse(
        agent.run_stream(sheets, history, session_id, images),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class ShareIn(BaseModel):
    title: str = "Чат"
    msgs: list[dict]


@app.post("/share")
def create_share(payload: ShareIn):
    if not payload.msgs:
        raise HTTPException(400, "msgs required")
    data = json.dumps({"title": payload.title, "msgs": payload.msgs}).encode()
    if len(data) > MAX_SHARE_BYTES:
        raise HTTPException(400, "чат слишком большой для шеринга")
    sid = files.stash(data, "share.json", ttl_s=SHARE_TTL_S)
    return {"share_id": sid}


@app.get("/share/{sid}")
def get_share(sid: str):
    item = files.fetch(sid)
    if not item:
        raise HTTPException(404, "ссылка истекла или не найдена")
    data, _ = item
    return json.loads(data)


DOWNLOAD_MIME = {
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".png": "image/png",
}


@app.get("/download/{did}")
def download(did: str):
    item = files.fetch(did)
    if not item:
        raise HTTPException(404, "expired or not found")
    data, filename = item
    mime = DOWNLOAD_MIME.get(os.path.splitext(filename.lower())[1], "application/octet-stream")
    return Response(
        content=data,
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
