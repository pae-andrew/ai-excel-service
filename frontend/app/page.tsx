"use client";
import { useRef, useState } from "react";
import { chat, downloadUrl, type Turn } from "../lib/api";

type Msg = Turn & { tools?: string[]; download?: { id: string; name: string } };

export default function Page() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const sentFile = useRef(false);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    if (!file && !sentFile.current) {
      alert("Загрузите .xlsx или .csv файл");
      return;
    }
    setInput("");
    setBusy(true);

    const history: Turn[] = [...msgs.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: text }];
    setMsgs((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);

    const fileToSend = sentFile.current ? null : file;
    sentFile.current = true;

    const update = (fn: (a: Msg) => void) =>
      setMsgs((m) => { const c = [...m]; fn(c[c.length - 1]); return c; });

    await chat(sessionId, history, fileToSend, {
      onText: (t) => update((a) => { a.content += t; }),
      onTool: (code) => update((a) => { a.tools = [...(a.tools || []), code]; }),
      onDone: (d) => { if (d.download_id) update((a) => { a.download = { id: d.download_id!, name: d.filename || "result.xlsx" }; }); },
      onError: (msg) => update((a) => { a.content += `\n⚠️ ${msg}`; }),
    });
    setBusy(false);
  }

  return (
    <main style={{ maxWidth: 780, margin: "0 auto", padding: 16, height: "100vh", display: "flex", flexDirection: "column" }}>
      <h2>📊 Excel AI-помощник</h2>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%", background: m.role === "user" ? "#2563eb" : "#fff", color: m.role === "user" ? "#fff" : "#111", padding: "8px 12px", borderRadius: 10, border: "1px solid #e3e6ea", whiteSpace: "pre-wrap" }}>
            {m.content || (busy && i === msgs.length - 1 ? "…" : "")}
            {m.tools?.map((c, j) => (
              <pre key={j} style={{ background: "#f1f3f5", padding: 8, borderRadius: 6, fontSize: 12, overflowX: "auto" }}>{c}</pre>
            ))}
            {m.download && (
              <div style={{ marginTop: 6 }}>
                <a href={downloadUrl(m.download.id)} style={{ color: "#2563eb" }}>⬇️ Скачать {m.download.name}</a>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        <input type="file" accept=".xlsx,.xlsm,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        {sentFile.current && <span style={{ fontSize: 12, color: "#888" }}>файл загружен</span>}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Что сделать с таблицей?"
          style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
        />
        <button onClick={send} disabled={busy} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}>
          {busy ? "…" : "Отправить"}
        </button>
      </div>
    </main>
  );
}
