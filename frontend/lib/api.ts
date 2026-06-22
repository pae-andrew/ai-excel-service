const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type Turn = { role: "user" | "assistant"; content: string };

export type StreamEvents = {
  onText: (t: string) => void;
  onTool: (code: string) => void;
  onDone: (d: { download_id?: string; filename?: string }) => void;
  onError: (m: string) => void;
};

// POST /chat and parse the SSE stream (EventSource can't POST multipart).
export async function chat(
  sessionId: string,
  history: Turn[],
  file: File | null,
  ev: StreamEvents,
) {
  const fd = new FormData();
  fd.append("session_id", sessionId);
  fd.append("messages", JSON.stringify(history));
  if (file) fd.append("file", file);

  const res = await fetch(`${API}/chat`, { method: "POST", body: fd });
  if (!res.ok) {
    ev.onError((await res.text()) || `HTTP ${res.status}`);
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split("\n\n");
    buf = blocks.pop() || "";
    for (const block of blocks) dispatch(block, ev);
  }
}

function dispatch(block: string, ev: StreamEvents) {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7);
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  if (!data) return;
  const parsed = JSON.parse(data);
  if (event === "text") ev.onText(parsed);
  else if (event === "tool") ev.onTool(parsed.code);
  else if (event === "done") ev.onDone(parsed);
  else if (event === "error") ev.onError(parsed.message);
}

export const downloadUrl = (id: string) => `${API}/download/${id}`;
