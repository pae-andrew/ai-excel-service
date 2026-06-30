import { notFound } from "next/navigation";
import { downloadUrl } from "../../../lib/api";
import { fileKind, fmtSize, fmtTokens, isImage } from "../../../lib/format";
import s from "../../page.module.css";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type SharedMsg = {
  role: "user" | "assistant";
  content: string;
  files?: { name: string; size: number }[];
  download?: { id: string; name: string };
  tools?: string[];
  usage?: { input_tokens: number; output_tokens: number };
};

export const dynamic = "force-dynamic"; // shares mutate (created on demand) — never cache the read

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${API}/share/${id}`, { cache: "no-store" });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`share fetch failed: ${res.status}`);
  const data: { title: string; msgs: SharedMsg[] } = await res.json();

  return (
    <div className={s.app}>
      <main className={s.main} style={{ flex: "1 1 100%" }}>
        <header className={s.header}>
          <div className={s.headerLeft}>
            <h3 className={s.headerTitle}>{data.title || "Чат"}</h3>
            <span className={`mono ${s.monoCaps} ${s.headerTag}`}>ТОЛЬКО ЧТЕНИЕ</span>
          </div>
          <a href="/" className={s.iconBtn}>Открыть Таблицы AI</a>
        </header>

        <div className={s.messages}>
          <div className={s.messagesInner}>
            {data.msgs.map((m, i) => m.role === "user" ? (
              <div key={i} className={s.userMsgWrap}>
                <div className={s.userBubble}>
                  {m.files?.map((f, j) => (
                    <div key={j} className={s.userFileRow}>
                      <span className="mono" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: fileKind(f.name).fg, background: fileKind(f.name).bg, flexShrink: 0 }}>
                        {fileKind(f.name).tag}
                      </span>
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
                <span style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, background: "radial-gradient(circle at 30% 28%, #1F9E63, var(--accent) 70%)" }} />
                <div className={s.assistantBody}>
                  {m.content && <div className={s.assistantText}>{m.content}</div>}

                  {m.tools && m.tools.length > 0 && (
                    <details className={s.toolDetails}>
                      <summary className={`mono ${s.monoCaps} ${s.toolSummary}`}>⌄ Код ({m.tools.length})</summary>
                      {m.tools.map((c, j) => <pre key={j} className={`mono ${s.toolPre}`}>{c}</pre>)}
                    </details>
                  )}

                  {m.download && (
                    <div className={s.downloadCard}>
                      <div className={`mono ${s.monoCaps} ${s.downloadLabel}`}>{isImage(m.download.name) ? "График" : "Результат"}</div>
                      {isImage(m.download.name) && (
                        <img src={downloadUrl(m.download.id)} alt={m.download.name} className={s.chartImg} />
                      )}
                      <div className={s.downloadRow}>
                        <a href={downloadUrl(m.download.id)} className={s.downloadBtn}>Скачать {m.download.name}</a>
                        {m.usage && (
                          <span className={`mono ${s.usageBadge}`} style={{ fontSize: 11 }}>
                            ≈ {fmtTokens(m.usage.input_tokens + m.usage.output_tokens)} ток.
                          </span>
                        )}
                      </div>
                      <div className={s.previewNote}>файл живёт 15 мин с момента генерации — ссылка может быть уже неактивна</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
