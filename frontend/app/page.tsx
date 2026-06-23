"use client";
import { useEffect, useRef, useState } from "react";
import { chat, downloadUrl, type Turn } from "../lib/api";

type Msg = Turn & { tools?: string[]; download?: { id: string; name: string } };
type Chat = { id: string; sessionId: string; title: string; msgs: Msg[] };

const STORE_KEY = "chats.v1";
const newId = () => crypto.randomUUID();
const blankChat = (): Chat => ({ id: newId(), sessionId: newId(), title: "Новый чат", msgs: [] });

export default function Page() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const sentFile = useRef(false);
  const activeRef = useRef("");
  activeRef.current = activeId;

  // Load history once (after mount, to avoid SSR/hydration mismatch).
  useEffect(() => {
    let loaded: Chat[] = [];
    try { loaded = JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch {}
    if (loaded.length) { setChats(loaded); setActiveId(loaded[0].id); }
    else { const c = blankChat(); setChats([c]); setActiveId(c.id); }
  }, []);

  // Persist on every change.
  useEffect(() => {
    if (chats.length) localStorage.setItem(STORE_KEY, JSON.stringify(chats));
  }, [chats]);

  const active = chats.find((c) => c.id === activeId);
  const msgs = active?.msgs ?? [];

  const patchActive = (fn: (c: Chat) => Chat) =>
    setChats((cs) => cs.map((c) => (c.id === activeRef.current ? fn(c) : c)));
  const patchLast = (fn: (a: Msg) => void) =>
    patchActive((c) => { const ms = [...c.msgs]; fn(ms[ms.length - 1]); return { ...c, msgs: ms }; });

  function newChat() {
    const c = blankChat();
    setChats((cs) => [c, ...cs]);
    setActiveId(c.id);
    sentFile.current = false;
    setFiles([]);
  }

  function selectChat(id: string) {
    setActiveId(id);
    setFiles([]);
    sentFile.current = (chats.find((c) => c.id === id)?.msgs.length ?? 0) > 0;
  }

  function deleteChat(id: string) {
    setChats((cs) => {
      const rest = cs.filter((c) => c.id !== id);
      const next = rest.length ? rest : [blankChat()];
      if (id === activeRef.current) setActiveId(next[0].id);
      return next;
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || !active) return;
    if (files.length === 0 && !sentFile.current) { alert("Загрузите файл(ы): .xlsx / .csv / .docx / .pdf"); return; }
    setInput("");
    setBusy(true);

    const history: Turn[] = [...msgs.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: text }];
    const title = active.msgs.length === 0 ? text.slice(0, 40) : active.title;
    patchActive((c) => ({ ...c, title, msgs: [...c.msgs, { role: "user", content: text }, { role: "assistant", content: "" }] }));

    const filesToSend = files; // send whenever new files are picked; else reuse backend session
    await chat(active.sessionId, history, filesToSend, {
      onText: (t) => patchLast((a) => { a.content += t; }),
      onTool: (code) => patchLast((a) => { a.tools = [...(a.tools || []), code]; }),
      onDone: (d) => { if (d.download_id) patchLast((a) => { a.download = { id: d.download_id!, name: d.filename || "result.xlsx" }; }); },
      onError: (m) => patchLast((a) => { a.content += `\n⚠️ ${m}`; }),
    });
    if (filesToSend.length) { sentFile.current = true; setFiles([]); }
    setBusy(false);
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* Sidebar: history */}
      <aside style={{ width: 220, borderRight: "1px solid #e3e6ea", background: "#fff", display: "flex", flexDirection: "column", padding: 10, gap: 6 }}>
        <button onClick={newChat} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", cursor: "pointer" }}>+ Новый чат</button>
        <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
          {chats.map((c) => (
            <div key={c.id} onClick={() => selectChat(c.id)}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4, padding: "7px 9px", borderRadius: 7, cursor: "pointer", fontSize: 13, background: c.id === activeId ? "#eef2ff" : "transparent", color: "#111" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title || "Новый чат"}</span>
              <span onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }} title="Удалить" style={{ color: "#bbb", cursor: "pointer" }}>×</span>
            </div>
          ))}
        </div>
      </aside>

      {/* Main: chat */}
      <main style={{ flex: 1, maxWidth: 820, margin: "0 auto", padding: 16, display: "flex", flexDirection: "column" }}>
        <h2 style={{ marginTop: 4 }}>📊 AI-помощник по таблицам</h2>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          {msgs.length === 0 && (
            <div style={{ margin: "auto", textAlign: "center", color: "#9aa0a6", maxWidth: 420 }}>
              <p style={{ fontSize: 15 }}>Загрузи один или несколько <b>.xlsx / .csv / .docx / .pdf</b> и опиши задачу.</p>
              <p style={{ fontSize: 13 }}>Например: «объедини два файла по колонке id», «сводная по регионам», «посчитай маржу».</p>
            </div>
          )}
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
          <input type="file" multiple accept=".xlsx,.xlsm,.csv,.docx,.pdf" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
          {files.length > 0 && <span style={{ fontSize: 12, color: "#555" }}>выбрано: {files.length}</span>}
          {sentFile.current && files.length === 0 && <span style={{ fontSize: 12, color: "#888" }}>файлы загружены</span>}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Что сделать с таблицей?" style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #ccc" }} />
          <button onClick={send} disabled={busy} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}>
            {busy ? "…" : "Отправить"}
          </button>
        </div>
      </main>
    </div>
  );
}
