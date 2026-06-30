export const isImage = (name: string) => /\.(png|jpe?g|webp|gif)$/i.test(name);

export function fileKind(name: string): { tag: string; fg: string; bg: string } {
  const n = name.toLowerCase();
  if (isImage(n)) return { tag: "IMG", fg: "var(--accent)", bg: "var(--accent-soft)" };
  if (n.endsWith(".pdf")) return { tag: "PDF", fg: "var(--file-pdf-fg)", bg: "var(--file-pdf-bg)" };
  if (n.endsWith(".docx")) return { tag: "DOC", fg: "var(--accent)", bg: "var(--accent-soft)" };
  if (n.endsWith(".csv")) return { tag: "CSV", fg: "var(--file-xls-fg)", bg: "var(--file-xls-bg)" };
  return { tag: "XLS", fg: "var(--file-xls-fg)", bg: "var(--file-xls-bg)" };
}

export const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
export const fmtTokens = (n: number) => n.toLocaleString("ru-RU");
