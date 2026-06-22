"""Live end-to-end check of the Claude loop. Needs .env with ANTHROPIC_API_KEY.
Run: python test_agent_live.py   (costs a few cents)
"""
import os
import json
import pathlib
import pandas as pd

# Load .env
for line in pathlib.Path(__file__).with_name(".env").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

import agent  # noqa: E402

df = pd.DataFrame({
    "name": ["Ann", "Bob", "Cy", "Dee"],
    "email": ["a@x.io", "", "c@x.io", ""],
    "region": ["N", "S", "N", "S"],
})

print("--- prompt: удали строки с пустым email и сохрани ---")
history = [{"role": "user", "content": "Удали строки где email пустой, сохрани результат."}]
got_download = False
for chunk in agent.run_stream(df, history, session_id="t1"):
    # chunk is an SSE string: event: X \n data: {...}
    lines = chunk.strip().split("\n")
    ev = lines[0].replace("event: ", "")
    data = lines[1].replace("data: ", "") if len(lines) > 1 else ""
    if ev == "text":
        print(json.loads(data), end="")
    elif ev == "tool":
        print(f"\n[TOOL]\n{json.loads(data)['code']}\n")
    elif ev == "done":
        d = json.loads(data)
        print(f"\n[DONE] {d}")
        got_download = bool(d.get("download_id"))
    elif ev == "error":
        print(f"\n[ERROR] {data}")

assert got_download, "expected a download_id (df should have changed)"
print("\nOK: live agent loop produced a downloadable result")
