const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type Turn = { role: "user" | "assistant"; content: string };

export type SheetPreview = { columns: string[]; rows: string[][]; total_rows: number; total_cols: number };
export type Usage = { input_tokens: number; output_tokens: number };
export type DoneData = {
  download_id?: string;
  filename?: string;
  usage?: Usage;
  model?: string;
  preview?: Record<string, SheetPreview> | null;
};

export type StreamEvents = {
  onText: (t: string) => void;
  onTool: (code: string) => void;
  onDone: (d: DoneData) => void;
  onError: (m: string) => void;
};

// POST /chat and parse the SSE stream (EventSource can't POST multipart).
export async function chat(
  sessionId: string,
  history: Turn[],
  files: File[],
  ev: StreamEvents,
  signal?: AbortSignal,
) {
  const fd = new FormData();
  fd.append("session_id", sessionId);
  fd.append("messages", JSON.stringify(history));
  for (const f of files) fd.append("file", f);

  let res: Response;
  try {
    res = await fetch(`${API}/chat`, { method: "POST", body: fd, signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") return; // user hit stop — not an error
    ev.onError("Сервер недоступен. Проверьте соединение.");
    return;
  }
  if (!res.ok) {
    ev.onError((await res.text()) || `HTTP ${res.status}`);
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split("\n\n");
      buf = blocks.pop() || "";
      for (const block of blocks) dispatch(block, ev);
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") ev.onError("Соединение прервано.");
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

// Full-page redirect into the backend's OAuth flow (no popup/postMessage —
// Google sends the browser back to `returnTo` with ?gsheet_url=...).
export const googleAuthUrl = (downloadId: string, returnTo: string) =>
  `${API}/google/auth?${new URLSearchParams({ download_id: downloadId, return_to: returnTo })}`;

// Stash a read-only snapshot of the chat transcript; returns its share id.
export async function createShare(title: string, msgs: unknown[]): Promise<string> {
  const res = await fetch(`${API}/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, msgs }),
  });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  const data = await res.json();
  return data.share_id as string;
}

// ponytail: approximate public per-1M-token pricing by model-name substring.
// Not wired to a live price feed — update PRICE_TABLE when prices change.
const PRICE_TABLE: { match: string; in: number; out: number }[] = [
  { match: "opus", in: 15, out: 75 },
  { match: "sonnet", in: 3, out: 15 },
  { match: "haiku", in: 0.8, out: 4 },
];

export function estimateCost(model: string, u: Usage): number | null {
  const row = PRICE_TABLE.find((p) => model.toLowerCase().includes(p.match));
  if (!row) return null;
  return (u.input_tokens * row.in + u.output_tokens * row.out) / 1_000_000;
}
