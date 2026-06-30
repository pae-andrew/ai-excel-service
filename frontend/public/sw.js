// App-shell cache: lets the chat UI open (no data, no backend) when offline.
// ponytail: network-first for navigations only — Next's hashed /_next/static
// assets already get long-lived HTTP caching from the browser, no need to
// duplicate that here and risk serving stale JS after a deploy.
const CACHE = "excel-ai-shell-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add("/")));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("/", copy));
        return res;
      })
      .catch(() => caches.match("/")),
  );
});
