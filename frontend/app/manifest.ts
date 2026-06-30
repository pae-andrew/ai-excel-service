import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Таблицы AI — Excel-ассистент",
    short_name: "Таблицы AI",
    description: "Чат-ассистент для xlsx/csv/docx/pdf: правки, сводные, маржа — без формул руками.",
    start_url: "/",
    display: "standalone",
    background_color: "#F0EDE4",
    theme_color: "#004741",
    lang: "ru",
    icons: [
      { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "maskable" },
      { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
