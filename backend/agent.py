"""Claude agentic loop: chat over a DataFrame with one run_pandas tool."""
import os
import json
import base64
import pandas as pd
from anthropic import Anthropic

import sandbox
import files

MODEL = os.getenv("MODEL", "claude-opus-4-8")
MAX_TURNS = 12

_client = Anthropic()  # reads ANTHROPIC_API_KEY from env

TOOLS = [{
    "name": "run_pandas",
    "description": (
        "Execute Python against the user's workbook. `sheets` is a dict mapping "
        "sheet name -> DataFrame; `df` is the first sheet (shortcut for "
        "single-sheet files). `pd` and `np` are available. To inspect, print() "
        "results. To modify: edit/reassign entries in `sheets` (e.g. "
        "sheets['Summary'] = sheets['Data'].groupby('region').sum()), or reassign "
        "`df` for the first sheet. Add a new sheet with sheets['Name'] = dataframe. "
        "Changes to sheets persist across calls and become the downloadable xlsx result.\n\n"
        "To return ANY other office format, build the file in memory and call "
        "save_result(filename, data) — data is bytes or a BytesIO. The filename's "
        "extension sets the download type:\n"
        "  • PDF: use matplotlib (import matplotlib; matplotlib.use('Agg')) — render a "
        "table or chart to a BytesIO with savefig(buf, format='pdf'); its fonts support "
        "Cyrillic. e.g. save_result('report.pdf', buf).\n"
        "  • DOCX: use python-docx (import docx), doc.save(BytesIO) → save_result('doc.docx', buf).\n"
        "  • CSV: save_result('data.csv', df.to_csv(index=False)).\n"
        "  • XLSX: also fine via save_result, or just edit `sheets`.\n"
        "  • PNG chart: matplotlib savefig(buf, format='png').\n"
        "Uploaded pictures are available as raw bytes: `images` (list) and `image` "
        "(first). When the user wants a screenshot/photo turned into a PDF/DOCX, "
        "EMBED the real bytes — do NOT redraw it. e.g. from PIL import Image; "
        "Image.open(io.BytesIO(image)).convert('RGB').save(buf, 'PDF'); "
        "save_result('screenshot.pdf', buf). For DOCX use docx with "
        "doc.add_picture(io.BytesIO(image)).\n"
        "Available libs: pandas, numpy, matplotlib, openpyxl, python-docx, PIL, csv, io, base64. "
        "No filesystem or network access — work in memory (io.BytesIO)."
    ),
    "input_schema": {
        "type": "object",
        "properties": {"code": {"type": "string", "description": "Python code to run."}},
        "required": ["code"],
    },
}]

SYSTEM = (
    "You are an assistant that works with office files for the user — spreadsheets, "
    "documents, PDFs and images. You can run Python via the run_pandas tool, which "
    "can also PRODUCE results in any format (xlsx, csv, pdf, docx, png) via "
    "save_result — so if the user asks for a PDF, a Word document, a chart, etc., "
    "generate it; never say you can only output xlsx. The workbook may have "
    "several sheets — they are in the `sheets` dict. If the user uploaded multiple "
    "files, each file's sheets are prefixed with its name (e.g. 'invoices_Sheet1'); "
    "you can join or merge across them and produce one result. Before destructive changes "
    "(dropping rows/columns/sheets), briefly state what you'll do. Inspect with "
    "print() first when unsure of the data. Answer in the user's language. After "
    "modifying the data, tell the user the result is ready to download.\n\n"
    "If no file is loaded (the workbook is empty), just answer the user's question "
    "or discuss the task normally, and invite them to attach a file when they want "
    "you to work on real data — do not call run_pandas when there is no data.\n\n"
    "Current workbook:\n{schema}"
)


def _sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _hash(sheets: dict):
    try:
        return tuple(
            (name, tuple(df.columns),
             int(pd.util.hash_pandas_object(df, index=True).sum()))
            for name, df in sheets.items()
        )
    except Exception:
        return None  # unhashable content -> treat as possibly changed


def run_stream(sheets: dict, history: list[dict], session_id: str = "", images: list = None):
    """Yield SSE strings. `history` = [{role, content(str)}...] from the client.
    `images` = [(media_type, base64)] attached to the latest user message (vision)."""
    system = SYSTEM.format(schema=files.schema_markdown(sheets))
    messages = [{"role": m["role"], "content": m["content"]} for m in history]
    if images and messages and messages[-1]["role"] == "user":
        blocks = [{"type": "text", "text": messages[-1]["content"]}]
        blocks += [{"type": "image", "source": {"type": "base64", "media_type": mt, "data": d}}
                   for mt, d in images]
        messages[-1]["content"] = blocks
    # Raw image bytes the sandbox can embed into output (image -> pdf/docx).
    img_bytes = [base64.b64decode(d) for _, d in (images or [])]
    start_hash = _hash(sheets)
    tool_ran = False
    last_output = None  # (filename, bytes) from save_result, persists across turns

    try:
        for _ in range(MAX_TURNS):
            with _client.messages.stream(
                model=MODEL, max_tokens=4096, system=system,
                tools=TOOLS, messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    yield _sse("text", text)
                final = stream.get_final_message()

            messages.append({"role": "assistant", "content": final.content})
            tool_uses = [b for b in final.content if b.type == "tool_use"]
            if not tool_uses:
                break

            results = []
            for tu in tool_uses:
                tool_ran = True
                code = tu.input.get("code", "")
                yield _sse("tool", {"code": code})
                sheets, outputs, stdout, err = sandbox.run(sheets, code, img_bytes)
                if outputs:
                    last_output = outputs[-1]
                note = f" [saved {last_output[0]}]" if outputs else ""
                payload = f"ERROR: {err}" if err else ((stdout or "ok") + note)
                results.append({
                    "type": "tool_result", "tool_use_id": tu.id, "content": payload,
                })
            messages.append({"role": "user", "content": results})

        if session_id:
            files.session_put(session_id, sheets)  # persist accumulated edits
        if last_output:  # explicit file (pdf/docx/csv/png/xlsx) wins
            name, data = last_output
            did = files.stash(data, name)
            yield _sse("done", {"download_id": did, "filename": name})
        elif tool_ran and (_hash(sheets) != start_hash or start_hash is None):
            did = files.stash(files.sheets_to_xlsx_bytes(sheets), "result.xlsx")
            yield _sse("done", {"download_id": did, "filename": "result.xlsx"})
        else:
            yield _sse("done", {})
    except Exception as e:  # noqa: BLE001
        yield _sse("error", {"message": str(e)})
