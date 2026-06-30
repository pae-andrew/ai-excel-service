import type { Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata = { title: "Таблицы AI" }; // app/manifest.ts auto-injects <link rel="manifest">
export const viewport: Viewport = { themeColor: "#004741" };

// Set theme before paint to avoid a flash of the wrong theme.
const themeInit = `(function(){try{var t=localStorage.getItem('theme');if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;}catch(e){}})();`;
// Register the app-shell service worker once the page is interactive.
const swInit = `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(function(){});}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Unbounded:wght@700;800&display=swap"
          rel="stylesheet"
        />
        <Script id="theme-init" strategy="beforeInteractive">{themeInit}</Script>
      </head>
      <body>
        {children}
        <Script id="sw-init" strategy="afterInteractive">{swInit}</Script>
      </body>
    </html>
  );
}
