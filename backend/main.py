"""FastAPI app: /chat (SSE), /download/{id}, /health."""
import os
import json
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response

import agent
import files

app = FastAPI(title="Excel AI assistant")

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
    file: UploadFile | None = File(None),
):
    try:
        history = json.loads(messages)
    except json.JSONDecodeError:
        raise HTTPException(400, "messages must be valid JSON")

    if file is not None:
        data = await file.read()
        try:
            sheets = files.read_to_sheets(data, file.filename)
        except Exception as e:  # parse/validation failures -> 400, not 500
            raise HTTPException(400, str(e))
        files.session_put(session_id, sheets)
    else:
        sheets = files.session_get(session_id)
        if sheets is None:
            raise HTTPException(400, "upload a spreadsheet first")

    return StreamingResponse(
        agent.run_stream(sheets, history, session_id),
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
