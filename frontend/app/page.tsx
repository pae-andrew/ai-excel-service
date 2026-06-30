"use client";
import { useEffect, useRef, useState } from "react";
import { chat, createShare, downloadUrl, estimateCost, googleAuthUrl, type SheetPreview, type Turn, type Usage } from "../lib/api";
import { fileKind, fmtSize, fmtTokens, isImage } from "../lib/format";
import s from "./page.module.css";

type Attn = { name: string; size: number };
type Msg = Turn & {
  tools?: string[];
  download?: { id: string; name: string };
  files?: Attn[];
  preview?: Record<string, SheetPreview> | null;
  usage?: Usage;
  model?: string;
  error?: string;
  stopped?: boolean;
};
type Chat = { id: string; sessionId: string; title: string; msgs: Msg[] };
type Toast = { id: string; msg: string };

const STORE_KEY = "chats.v1";
const newId = () => crypto.randomUUID();
const blankChat = (): Chat => ({ id: newId(), sessionId: newId(), title: "Новый чат", msgs: [] });
const ACCEPT = [".xlsx", ".xlsm", ".csv", ".docx", ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif"];
const PRESETS = ["Удали дубли", "Сводная по регионам", "Посчитай маржу", "Объедини файлы по id"];

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
  stop: <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>,
  sun: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  moon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>,
  clock: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  menu: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>,
  dl: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>,
  trash: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>,
  guest: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></svg>,
  sheet: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></svg>,
  share: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 10.5l6.8-3.9M8.6 13.5l6.8 3.9" /></svg>,
};

function Orb({ size = 30 }: { size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, background: "radial-gradient(circle at 30% 28%, #1F9E63, var(--accent) 70%)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.12)" }} />;
}

function TablePreview({ preview }: { preview: Record<string, SheetPreview> }) {
  const names = Object.keys(preview);
  const [tab, setTab] = useState(names[0]);
  const sheet = preview[tab] ?? preview[names[0]];
  if (!sheet) return null;
  const shown = sheet.rows.length;
  return (
    <div className={s.previewWrap}>
      {names.length > 1 && (
        <div className={s.previewTabs}>
          {names.map((n) => (
            <button key={n} onClick={() => setTab(n)} className={`${s.previewTab} ${(tab || names[0]) === n ? s.previewTabActive : ""}`}>{n}</button>
          ))}
        </div>
      )}
      <div className={s.previewTableScroll}>
        <table className={s.previewTable}>
          <thead><tr>{sheet.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
          <tbody>
            {sheet.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
      <div className={s.previewNote}>
        показано {shown} из {sheet.total_rows} строк · {sheet.total_cols} столбцов
      </div>
    </div>
  );
}

export default function Page() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const sentFile = useRef(false);
  const activeRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  activeRef.current = activeId;
  const pageUrl = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const gsheetUrl = qs.get("gsheet_url");
    if (gsheetUrl) {
      const name = qs.get("gsheet_name") || "таблица";
      addToast(`Экспортировано в Google Sheets: ${name}`);
      window.open(gsheetUrl, "_blank");
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as "light" | "dark") || "light");
    let loadedChats: Chat[] = [];
    try { loadedChats = JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch {}
    if (loadedChats.length) { setChats(loadedChats); setActiveId(loadedChats[0].id); }
    else { const c = blankChat(); setChats([c]); setActiveId(c.id); }
    setLoaded(true);
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

  function addToast(msg: string) {
    const id = newId();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }

  const patchActive = (fn: (c: Chat) => Chat) => setChats((cs) => cs.map((c) => (c.id === activeRef.current ? fn(c) : c)));
  const patchLast = (fn: (a: Msg) => void) => patchActive((c) => { const ms = [...c.msgs]; fn(ms[ms.length - 1]); return { ...c, msgs: ms }; });

  function newChat() { const c = blankChat(); setChats((cs) => [c, ...cs]); setActiveId(c.id); sentFile.current = false; setFiles([]); setSidebarOpen(false); }
  function selectChat(id: string) { setActiveId(id); setFiles([]); sentFile.current = (chats.find((c) => c.id === id)?.msgs.length ?? 0) > 0; setSidebarOpen(false); }
  function deleteChat(id: string) {
    setChats((cs) => { const rest = cs.filter((c) => c.id !== id); const next = rest.length ? rest : [blankChat()]; if (id === activeRef.current) setActiveId(next[0].id); return next; });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) => ACCEPT.some((ext) => f.name.toLowerCase().endsWith(ext)));
    if (dropped.length) setFiles(dropped);
    else addToast("Этот тип файла не поддерживается");
  }

  function onPaste(e: React.ClipboardEvent) {
    const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (imgs.length) {
      e.preventDefault();
      const named = imgs.map((f) => new File([f], f.name && f.name !== "image.png" ? f.name : `screenshot-${Date.now()}.png`, { type: f.type }));
      setFiles((prev) => [...prev, ...named]);
    }
  }

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || busy || !active) return;
    setInput(""); setBusy(true);

    const history: Turn[] = [...msgs.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: text }];
    const title = active.msgs.length === 0 ? text.slice(0, 40) : active.title;
    const attn: Attn[] = files.map((f) => ({ name: f.name, size: f.size }));
    patchActive((c) => ({ ...c, title, msgs: [...c.msgs, { role: "user", content: text, files: attn }, { role: "assistant", content: "" }] }));

    const filesToSend = files;
    const controller = new AbortController();
    abortRef.current = controller;
    await chat(active.sessionId, history, filesToSend, {
      onText: (t) => patchLast((a) => { a.content += t; }),
      onTool: (code) => patchLast((a) => { a.tools = [...(a.tools || []), code]; }),
      onDone: (d) => patchLast((a) => {
        if (d.download_id) a.download = { id: d.download_id, name: d.filename || "result.xlsx" };
        if (d.preview && Object.keys(d.preview).length) a.preview = d.preview;
        if (d.usage) { a.usage = d.usage; a.model = d.model; }
      }),
      onError: (m) => { patchLast((a) => { a.error = m; }); addToast(m); },
    }, controller.signal);
    if (filesToSend.length) { sentFile.current = true; setFiles([]); }
    abortRef.current = null;
    setBusy(false);
  }

  function stop() {
    abortRef.current?.abort();
    patchLast((a) => { a.stopped = true; });
  }

  async function shareChat() {
    if (!active || msgs.length === 0) return;
    try {
      const id = await createShare(active.title, msgs);
      const url = `${origin}/share/${id}`;
      try {
        await navigator.clipboard.writeText(url);
        addToast(`Ссылка скопирована (живёт 24ч): ${url}`);
      } catch {
        addToast(`Ссылка (живёт 24ч): ${url}`);
      }
    } catch {
      addToast("Не удалось создать ссылку");
    }
  }

  function retry(text: string) {
    patchActive((c) => ({ ...c, msgs: c.msgs.slice(0, -2) }));
    send(text);
  }

  const monoCaps = s.monoCaps;
  const allVersions = msgs.map((m, i) => ({ ...m.download, i })).filter((v) => v.id) as { id: string; name: string; i: number }[];

  return (
    <div className={s.app}>
      {sidebarOpen && <div className={s.sidebarOverlay} onClick={() => setSidebarOpen(false)} />}

      {/* ===== Sidebar ===== */}
      <aside className={`${s.sidebar} ${sidebarOpen ? s.sidebarOpen : ""}`}>
        <div className={s.sidebarHead}>
          <Orb size={30} />
          <span className={s.logoText}>Таблицы AI</span>
        </div>

        <button onClick={newChat} className={s.newChatBtn}>{I.plus} Новый чат</button>

        <div className={`${monoCaps} ${s.historyLabel}`}>История</div>
        <div className={s.historyList}>
          {!loaded ? (
            <>{[0, 1, 2].map((i) => <div key={i} className={s.skeletonBar} />)}</>
          ) : chats.map((c) => {
            const activeC = c.id === activeId;
            const firstFile = c.msgs.find((m) => m.files?.length)?.files?.[0]?.name;
            const desc = c.msgs.find((m) => m.role === "user")?.content || "";
            return (
              <div key={c.id} onClick={() => selectChat(c.id)} className={`${s.historyItem} ${activeC ? s.historyItemActive : ""}`}>
                {firstFile ? <FileTile name={firstFile} /> : <span style={{ width: 30 }} />}
                <div className={s.historyMeta}>
                  <div className={s.historyTitle}>{c.title || "Новый чат"}</div>
                  {desc && <div className={s.historyDesc}>{desc}</div>}
                </div>
                <button onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }} title="Удалить" className={s.historyDelete}>{I.trash}</button>
              </div>
            );
          })}
        </div>

        <div className={s.profileRow}>
          <span className={s.profileAvatar}>{I.guest}</span>
          <div className={s.profileMeta}>
            <div className={s.profileName}>Гость</div>
            <div className={s.profileSub}>Локальная сессия · файлы хранятся 15&nbsp;мин</div>
          </div>
        </div>
      </aside>

      {/* ===== Main ===== */}
      <main onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }} onDrop={onDrop} className={s.main}>
        {dragOver && <div className={s.dropOverlay}>Отпусти файлы сюда</div>}

        <header className={s.header}>
          <div className={s.headerLeft}>
            <button className={`${s.roundBtn} ${s.hamburgerBtn}`} onClick={() => setSidebarOpen(true)} title="Меню">{I.menu}</button>
            <h3 className={s.headerTitle}>{active?.title || "Новый чат"}</h3>
            {msgs.find((m) => m.files?.length) && (
              <span className={`mono ${monoCaps} ${s.headerTag}`}>
                {fileKind(msgs.find((m) => m.files?.length)!.files![0].name).tag}
              </span>
            )}
          </div>
          <div className={s.headerActions}>
            {msgs.length > 0 && (
              <button onClick={shareChat} className={s.iconBtn} title="Скопировать read-only ссылку на чат">{I.share} Поделиться</button>
            )}
            {allVersions.length > 0 && (
              <div className={s.versionsWrap}>
                <button onClick={() => setVersionsOpen((v) => !v)} className={s.iconBtn}>{I.clock} Версии ({allVersions.length})</button>
                {versionsOpen && (
                  <div className={s.versionsDropdown} onMouseLeave={() => setVersionsOpen(false)}>
                    {allVersions.slice().reverse().map((v, k) => (
                      <a key={v.i} href={downloadUrl(v.id)} className={s.versionsItem}>
                        {I.dl}
                        <span className={s.versionsItemName}>{v.name}</span>
                        <span className={s.versionsItemIdx}>#{allVersions.length - k}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button onClick={toggleTheme} title="Сменить тему" className={s.iconBtn}>
              {theme === "dark" ? I.sun : I.moon}{theme === "dark" ? "Светлая" : "Тёмная"}
            </button>
          </div>
        </header>

        {/* Messages */}
        <div ref={scroller} className={s.messages}>
          <div className={s.messagesInner}>
            {msgs.length === 0 && (
              <div className={s.emptyState}>
                <div className={s.emptyOrbWrap}><Orb size={52} /></div>
                <p className={s.emptyTitle}>Загрузите .xlsx / .csv / .pdf / .docx и опишите задачу</p>
                <p className={s.emptyDesc}>Можно перетащить файлы сюда или работать без файла.</p>
                <div className={s.chipsRow}>
                  {PRESETS.map((p) => <button key={p} className={s.chip} onClick={() => setInput(p)}>{p}</button>)}
                </div>
              </div>
            )}

            {msgs.map((m, i) => m.role === "user" ? (
              <div key={i} className={s.userMsgWrap}>
                <div className={s.userBubble}>
                  {m.files?.map((f, j) => (
                    <div key={j} className={s.userFileRow}>
                      <FileTile name={f.name} />
                      <div className={s.userFileMeta}>
                        <div className={s.userFileName}>{f.name}</div>
                        <div className={`mono ${s.userFileSize}`}>{fmtSize(f.size)}</div>
                      </div>
                    </div>
                  ))}
                  <div className={s.userText}>{m.content}</div>
                </div>
              </div>
            ) : (
              <div key={i} className={s.assistantMsgWrap}>
                <Orb size={30} />
                <div className={s.assistantBody}>
                  {m.content ? (
                    <div className={s.assistantText}>{m.content}</div>
                  ) : busy && i === msgs.length - 1 ? (
                    <div className="typing" style={{ padding: "6px 0" }}><span /><span /><span /></div>
                  ) : null}

                  {m.stopped && <div className={s.stoppedNote}>Генерация остановлена</div>}

                  {m.error && (
                    <div className={s.errorBanner}>
                      <span>⚠️ {m.error}</span>
                      <button className={s.errorRetryBtn} onClick={() => retry(msgs[i - 1]?.content || "")}>Повторить</button>
                    </div>
                  )}

                  {m.tools && m.tools.length > 0 && (
                    <details className={s.toolDetails}>
                      <summary className={`mono ${monoCaps} ${s.toolSummary}`}>⌄ Код ({m.tools.length})</summary>
                      {m.tools.map((c, j) => <pre key={j} className={`mono ${s.toolPre}`}>{c}</pre>)}
                    </details>
                  )}

                  {m.preview && Object.keys(m.preview).length > 0 && <TablePreview preview={m.preview} />}

                  {m.download && (
                    <div className={s.downloadCard}>
                      <div className={`mono ${monoCaps} ${s.downloadLabel}`}>{isImage(m.download.name) ? "График · готов" : "Результат · готов"}</div>
                      {isImage(m.download.name) && (
                        <a href={downloadUrl(m.download.id)} target="_blank" rel="noreferrer">
                          <img src={downloadUrl(m.download.id)} alt={m.download.name} className={s.chartImg} />
                        </a>
                      )}
                      <div className={s.downloadRow}>
                        <a href={downloadUrl(m.download.id)} className={s.downloadBtn}>{I.dl} Скачать {m.download.name}</a>
                        {!isImage(m.download.name) && (
                          <a href={googleAuthUrl(m.download.id, pageUrl)} className={s.iconBtn}>
                            {I.sheet} В Google Sheets
                          </a>
                        )}
                        {m.usage && (
                          <span className={`mono ${s.usageBadge}`} style={{ fontSize: 11 }}>
                            ≈ {fmtTokens(m.usage.input_tokens + m.usage.output_tokens)} ток.
                            {m.model && estimateCost(m.model, m.usage) !== null && ` · $${estimateCost(m.model, m.usage)!.toFixed(4)}`}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Input dock */}
        <div className={s.dock}>
          <div className={s.dockInner}>
            {files.length > 0 && (
              <div className={s.attachedFiles}>
                {files.map((f, i) => (
                  <div key={i} className={s.attachedFile}>
                    {isImage(f.name)
                      ? <img src={URL.createObjectURL(f)} alt="" className={s.attachedFileImg} />
                      : <FileTile name={f.name} />}
                    <span className={s.attachedFileName}>{f.name}</span>
                    <span className={`mono ${s.attachedFileSize}`}>{fmtSize(f.size)}</span>
                    <button className={s.attachedFileRemove} onClick={() => setFiles(files.filter((_, j) => j !== i))}>{I.trash}</button>
                  </div>
                ))}
              </div>
            )}
            {sentFile.current && files.length === 0 && (
              <div className={`mono ${s.sentFileNote}`}>файлы из этого чата загружены</div>
            )}

            <div className={s.inputBar}>
              <input ref={fileInput} type="file" multiple accept={ACCEPT.join(",")} style={{ display: "none" }} onChange={(e) => setFiles(Array.from(e.target.files || []))} />
              <button onClick={() => fileInput.current?.click()} title="Прикрепить файл" className={s.roundBtn}>{I.plus}</button>
              <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} onPaste={onPaste} placeholder="Спросите про таблицу, документ или скриншот…" className={s.textInput} />
              {busy ? (
                <button onClick={stop} title="Остановить" className={`${s.sendBtn} ${s.stopBtn}`}>{I.stop}</button>
              ) : (
                <button onClick={() => send()} disabled={!input.trim()} title="Отправить" className={`${s.sendBtn} ${!input.trim() ? s.sendBtnDisabled : ""}`}>{I.up}</button>
              )}
            </div>
            <div className={`mono ${s.hintText}`}>
              XLSX · CSV · PDF · DOCX · PNG/JPG · вставка скриншота ⌘V · несколько файлов
            </div>
          </div>
        </div>
      </main>

      <div className={s.toastStack}>
        {toasts.map((t) => <div key={t.id} className={s.toast}>{t.msg}</div>)}
      </div>
    </div>
  );
}
