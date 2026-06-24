"use client";
import { useEffect, useRef, useState } from "react";
import { chat, downloadUrl, type Turn } from "../lib/api";

type Attn = { name: string; size: number };
type Msg = Turn & { tools?: string[]; download?: { id: string; name: string }; files?: Attn[] };
type Chat = { id: string; sessionId: string; title: string; msgs: Msg[] };

const STORE_KEY = "chats.v1";
const newId = () => crypto.randomUUID();
const blankChat = (): Chat => ({ id: newId(), sessionId: newId(), title: "Новый чат", msgs: [] });
const ACCEPT = [".xlsx", ".xlsm", ".csv", ".docx", ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif"];
const isImage = (name: string) => /\.(png|jpe?g|webp|gif)$/i.test(name);

function fileKind(name: string): { tag: string; fg: string; bg: string } {
  const n = name.toLowerCase();
  if (isImage(n)) return { tag: "IMG", fg: "var(--accent)", bg: "var(--accent-soft)" };
  if (n.endsWith(".pdf")) return { tag: "PDF", fg: "var(--file-pdf-fg)", bg: "var(--file-pdf-bg)" };
  if (n.endsWith(".docx")) return { tag: "DOC", fg: "var(--accent)", bg: "var(--accent-soft)" };
  if (n.endsWith(".csv")) return { tag: "CSV", fg: "var(--file-xls-fg)", bg: "var(--file-xls-bg)" };
  return { tag: "XLS", fg: "var(--file-xls-fg)", bg: "var(--file-xls-bg)" };
}
const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);

function FileTile({ name }: { name: string }) {
  const k = fileKind(name);
  return (
    <span className="mono" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: k.fg, background: k.bg, flexShrink: 0 }}>
      {k.tag}
    </span>
  );
}

// --- minimal inline icons (no icon dependency) ---
const I = {
  plus: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
  up: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>,
  sun: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  moon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>,
  gear: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 0 1 4 0v.1A1.6 1.6 0 0 0 17 2.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></svg>,
  dl: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>,
  trash: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>,
};

function Orb({ size = 30 }: { size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, background: "radial-gradient(circle at 30% 28%, #1F9E63, var(--accent) 70%)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.12)" }} />;
}

export default function Page() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const sentFile = useRef(false);
  const activeRef = useRef("");
  const fileInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  activeRef.current = activeId;

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as "light" | "dark") || "light");
    let loaded: Chat[] = [];
    try { loaded = JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch {}
    if (loaded.length) { setChats(loaded); setActiveId(loaded[0].id); }
    else { const c = blankChat(); setChats([c]); setActiveId(c.id); }
  }, []);

  useEffect(() => { if (chats.length) localStorage.setItem(STORE_KEY, JSON.stringify(chats)); }, [chats]);

  const active = chats.find((c) => c.id === activeId);
  const msgs = active?.msgs ?? [];

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs, busy]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch {}
  }

  const patchActive = (fn: (c: Chat) => Chat) => setChats((cs) => cs.map((c) => (c.id === activeRef.current ? fn(c) : c)));
  const patchLast = (fn: (a: Msg) => void) => patchActive((c) => { const ms = [...c.msgs]; fn(ms[ms.length - 1]); return { ...c, msgs: ms }; });

  function newChat() { const c = blankChat(); setChats((cs) => [c, ...cs]); setActiveId(c.id); sentFile.current = false; setFiles([]); }
  function selectChat(id: string) { setActiveId(id); setFiles([]); sentFile.current = (chats.find((c) => c.id === id)?.msgs.length ?? 0) > 0; }
  function deleteChat(id: string) {
    setChats((cs) => { const rest = cs.filter((c) => c.id !== id); const next = rest.length ? rest : [blankChat()]; if (id === activeRef.current) setActiveId(next[0].id); return next; });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) => ACCEPT.some((ext) => f.name.toLowerCase().endsWith(ext)));
    if (dropped.length) setFiles(dropped);
  }

  function onPaste(e: React.ClipboardEvent) {
    const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (imgs.length) {
      e.preventDefault();
      // clipboard screenshots are often named "image.png" — give them unique names
      const named = imgs.map((f) => new File([f], f.name && f.name !== "image.png" ? f.name : `screenshot-${Date.now()}.png`, { type: f.type }));
      setFiles((prev) => [...prev, ...named]);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || !active) return;
    setInput(""); setBusy(true);

    const history: Turn[] = [...msgs.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: text }];
    const title = active.msgs.length === 0 ? text.slice(0, 40) : active.title;
    const attn: Attn[] = files.map((f) => ({ name: f.name, size: f.size }));
    patchActive((c) => ({ ...c, title, msgs: [...c.msgs, { role: "user", content: text, files: attn }, { role: "assistant", content: "" }] }));

    const filesToSend = files;
    await chat(active.sessionId, history, filesToSend, {
      onText: (t) => patchLast((a) => { a.content += t; }),
      onTool: (code) => patchLast((a) => { a.tools = [...(a.tools || []), code]; }),
      onDone: (d) => { if (d.download_id) patchLast((a) => { a.download = { id: d.download_id!, name: d.filename || "result.xlsx" }; }); },
      onError: (m) => patchLast((a) => { a.content += `\n⚠️ ${m}`; }),
    });
    if (filesToSend.length) { sentFile.current = true; setFiles([]); }
    setBusy(false);
  }

  const monoCaps = { fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase" as const };

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg)" }}>
      {/* ===== Sidebar ===== */}
      <aside style={{ width: 268, flexShrink: 0, background: "var(--sidebar)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 4px 16px" }}>
          <Orb size={30} />
          <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.2, color: "var(--text)" }}>Таблицы AI</span>
        </div>

        <button onClick={newChat} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "11px 14px", borderRadius: 12, border: "none", background: "var(--accent)", color: "var(--accent-on)", fontWeight: 700, fontSize: 14, cursor: "pointer", boxShadow: "var(--shadow-btn)" }}>
          {I.plus} Новый чат
        </button>

        <div style={{ ...monoCaps, color: "var(--text-muted)", margin: "20px 4px 8px" }}>История</div>
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {chats.map((c) => {
            const activeC = c.id === activeId;
            const firstFile = c.msgs.find((m) => m.files?.length)?.files?.[0]?.name;
            const desc = c.msgs.find((m) => m.role === "user")?.content || "";
            return (
              <div key={c.id} onClick={() => selectChat(c.id)}
                style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 10, cursor: "pointer", background: activeC ? "var(--surface)" : "transparent", border: `1px solid ${activeC ? "var(--border)" : "transparent"}`, boxShadow: activeC ? "var(--shadow-card)" : "none" }}>
                {firstFile ? <FileTile name={firstFile} /> : <span style={{ width: 30 }} />}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title || "Новый чат"}</div>
                  {desc && <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{desc}</div>}
                </div>
                <span onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }} title="Удалить" style={{ color: "var(--text-muted)", display: "flex", padding: 2 }}>{I.trash}</span>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 14, marginTop: 8, borderTop: "1px solid var(--border)" }}>
          <span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--accent)", color: "var(--accent-on)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13 }}>А</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Andrew</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Бухгалтерия · Pro</div>
          </div>
          <span style={{ color: "var(--text-secondary)", display: "flex", cursor: "pointer" }} title="Настройки">{I.gear}</span>
        </div>
      </aside>

      {/* ===== Main ===== */}
      <main onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }} onDrop={onDrop}
        style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative", minWidth: 0 }}>
        {dragOver && (
          <div style={{ position: "absolute", inset: 14, zIndex: 9, border: "2px dashed var(--accent)", borderRadius: 16, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)", fontWeight: 700, fontSize: 16, pointerEvents: "none" }}>
            Отпусти файлы сюда
          </div>
        )}

        {/* Header */}
        <header style={{ height: 60, flexShrink: 0, borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 26px", background: "var(--bg)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{active?.title || "Новый чат"}</h3>
            {msgs.find((m) => m.files?.length) && (
              <span className="mono" style={{ ...monoCaps, color: "var(--accent)", background: "var(--accent-soft)", padding: "3px 7px", borderRadius: 6 }}>
                {fileKind(msgs.find((m) => m.files?.length)!.files![0].name).tag}
              </span>
            )}
          </div>
          <button onClick={toggleTheme} title="Сменить тему" style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
            {theme === "dark" ? I.sun : I.moon}{theme === "dark" ? "Светлая" : "Тёмная"}
          </button>
        </header>

        {/* Messages */}
        <div ref={scroller} style={{ flex: 1, overflowY: "auto", padding: "26px 26px 8px" }}>
          <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 22 }}>
            {msgs.length === 0 && (
              <div style={{ margin: "auto", textAlign: "center", color: "var(--text-secondary)", maxWidth: 440, paddingTop: "12vh" }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}><Orb size={52} /></div>
                <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: "0 0 6px" }}>Загрузите .xlsx / .csv / .pdf / .docx и опишите задачу</p>
                <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: 0 }}>Можно перетащить файлы сюда или работать без файла. Например: «объедини два файла по id», «сводная по регионам», «посчитай маржу».</p>
              </div>
            )}

            {msgs.map((m, i) => m.role === "user" ? (
              <div key={i} style={{ alignSelf: "flex-end", maxWidth: "82%" }}>
                <div style={{ background: "var(--accent)", color: "var(--accent-on)", padding: "11px 14px", borderRadius: "18px 18px 4px 18px", boxShadow: "var(--shadow-btn)" }}>
                  {m.files?.map((f, j) => (
                    <div key={j} style={{ display: "flex", alignItems: "center", gap: 9, background: "rgba(255,255,255,.12)", borderRadius: 10, padding: "7px 9px", marginBottom: 8 }}>
                      <FileTile name={f.name} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                        <div className="mono" style={{ fontSize: 10.5, opacity: .8 }}>{fmtSize(f.size)}</div>
                      </div>
                    </div>
                  ))}
                  <div style={{ fontSize: 14.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{m.content}</div>
                </div>
              </div>
            ) : (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <Orb size={30} />
                <div style={{ minWidth: 0, flex: 1, maxWidth: 620 }}>
                  {m.content ? (
                    <div style={{ fontSize: 14.5, lineHeight: 1.55, color: "var(--text)", whiteSpace: "pre-wrap" }}>{m.content}</div>
                  ) : busy && i === msgs.length - 1 ? (
                    <div className="typing" style={{ padding: "6px 0" }}><span /><span /><span /></div>
                  ) : null}

                  {m.tools && m.tools.length > 0 && (
                    <details style={{ marginTop: 10 }}>
                      <summary className="mono" style={{ ...monoCaps, color: "var(--text-muted)", cursor: "pointer", listStyle: "none" }}>
                        ⌄ Код ({m.tools.length})
                      </summary>
                      {m.tools.map((c, j) => (
                        <pre key={j} className="mono" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-secondary)", padding: 10, borderRadius: 10, fontSize: 11.5, overflowX: "auto", marginTop: 8 }}>{c}</pre>
                      ))}
                    </details>
                  )}

                  {m.download && (
                    <div style={{ marginTop: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 14, boxShadow: "var(--shadow-card)" }}>
                      <div className="mono" style={{ ...monoCaps, color: "var(--text-muted)", marginBottom: 10 }}>Результат · готов</div>
                      <a href={downloadUrl(m.download.id)} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 14px", borderRadius: 11, background: "var(--accent)", color: "var(--accent-on)", fontWeight: 700, fontSize: 13.5, textDecoration: "none", boxShadow: "var(--shadow-btn)" }}>
                        {I.dl} Скачать {m.download.name}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Input dock */}
        <div style={{ padding: "10px 26px 18px", background: "var(--bg)" }}>
          <div style={{ maxWidth: 760, margin: "0 auto" }}>
            {files.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                {files.map((f, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "6px 10px 6px 7px", boxShadow: "var(--shadow-card)" }}>
                    {isImage(f.name)
                      ? <img src={URL.createObjectURL(f)} alt="" style={{ width: 30, height: 30, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                      : <FileTile name={f.name} />}
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    <span className="mono" style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{fmtSize(f.size)}</span>
                    <span onClick={() => setFiles(files.filter((_, j) => j !== i))} style={{ color: "var(--text-muted)", cursor: "pointer", display: "flex" }}>{I.trash}</span>
                  </div>
                ))}
              </div>
            )}
            {sentFile.current && files.length === 0 && (
              <div className="mono" style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>файлы из этого чата загружены</div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 7, boxShadow: "var(--shadow-card)" }}>
              <input ref={fileInput} type="file" multiple accept={ACCEPT.join(",")} style={{ display: "none" }} onChange={(e) => setFiles(Array.from(e.target.files || []))} />
              <button onClick={() => fileInput.current?.click()} title="Прикрепить файл" style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 11, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>{I.plus}</button>
              <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} onPaste={onPaste} placeholder="Спросите про таблицу, документ или скриншот…"
                style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: 14.5, fontFamily: "inherit" }} />
              <button onClick={send} disabled={busy || !input.trim()} title="Отправить" style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 11, border: "none", background: "var(--accent)", color: "var(--accent-on)", cursor: busy || !input.trim() ? "default" : "pointer", opacity: busy || !input.trim() ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-btn)" }}>{I.up}</button>
            </div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--text-muted)", letterSpacing: 0.5, marginTop: 8, textAlign: "center" }}>
              XLSX · CSV · PDF · DOCX · PNG/JPG · вставка скриншота ⌘V · несколько файлов
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
