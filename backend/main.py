"""FastAPI app: /chat (SSE), /download/{id}, /health. Deployed via GitHub Actions."""
import os
import json
import base64
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response

import agent
import files

app = FastAPI(title="Excel AI assistant")

IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".webp": "image/webp", ".gif": "image/gif"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("ALLOWED_ORIGIN", "http://localhost:3000")],
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.get("/download/{did}")
def download(did: str):
    item = files.fetch(did)
    if not item:
        raise HTTPException(404, "expired or not found")
    data, filename = item
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
