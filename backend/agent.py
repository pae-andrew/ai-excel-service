"""Claude agentic loop: chat over a DataFrame with one run_pandas tool."""
import os
import json
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
        "Changes persist across calls and become the downloadable result. "
        "No filesystem or network access."
    ),
    "input_schema": {
        "type": "object",
        "properties": {"code": {"type": "string", "description": "Python code to run."}},
        "required": ["code"],
    },
}]

SYSTEM = (
    "You are an assistant that works with spreadsheets for the user. You can run "
    "Python (pandas) on their data via the run_pandas tool. The workbook may have "
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
    start_hash = _hash(sheets)
    tool_ran = False

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
                sheets, stdout, err = sandbox.run(sheets, code)
                payload = f"ERROR: {err}" if err else (stdout or "ok (no output)")
                results.append({
                    "type": "tool_result", "tool_use_id": tu.id, "content": payload,
                })
            messages.append({"role": "user", "content": results})

        if session_id:
            files.session_put(session_id, sheets)  # persist accumulated edits
        changed = tool_ran and (_hash(sheets) != start_hash or start_hash is None)
        if changed:
            did = files.stash(files.sheets_to_xlsx_bytes(sheets), "result.xlsx")
            yield _sse("done", {"download_id": did, "filename": "result.xlsx"})
        else:
            yield _sse("done", {})
    except Exception as e:  # noqa: BLE001
        yield _sse("error", {"message": str(e)})
