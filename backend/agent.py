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
        "Execute Python against the user's spreadsheet. The DataFrame is in scope "
        "as `df`; `pd` and `np` are available. To inspect, print() results. To "
        "modify the spreadsheet, reassign `df` (e.g. df = df.drop_duplicates()). "
        "Mutations to `df` persist across calls and become the downloadable result. "
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
    "Python (pandas) on their data via the run_pandas tool. Before destructive "
    "changes (dropping rows/columns), briefly state what you'll do. Inspect with "
    "print() first when unsure of the data. Answer in the user's language. After "
    "modifying `df`, tell the user the result is ready to download.\n\n"
    "Current spreadsheet:\n{schema}"
)


def _sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _hash(df: pd.DataFrame):
    try:
        return (tuple(df.columns), int(pd.util.hash_pandas_object(df, index=True).sum()))
    except Exception:
        return None  # unhashable content -> treat as possibly changed


def run_stream(df: pd.DataFrame, history: list[dict], session_id: str = ""):
    """Yield SSE strings. `history` = [{role, content(str)}...] from the client."""
    system = SYSTEM.format(schema=files.schema_markdown(df))
    messages = [{"role": m["role"], "content": m["content"]} for m in history]
    start_hash = _hash(df)
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
                df, stdout, err = sandbox.run(df, code)
                payload = f"ERROR: {err}" if err else (stdout or "ok (no output)")
                results.append({
                    "type": "tool_result", "tool_use_id": tu.id, "content": payload,
                })
            messages.append({"role": "user", "content": results})

        if session_id:
            files.session_put(session_id, df)  # persist accumulated edits
        changed = tool_ran and (_hash(df) != start_hash or start_hash is None)
        if changed:
            did = files.stash(files.df_to_xlsx_bytes(df), "result.xlsx")
            yield _sse("done", {"download_id": did, "filename": "result.xlsx"})
        else:
            yield _sse("done", {})
    except Exception as e:  # noqa: BLE001
        yield _sse("error", {"message": str(e)})
