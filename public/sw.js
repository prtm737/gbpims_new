/* GBPIMS service worker — app-shell caching for instant repeat loads and
 * offline fallback. Data (/_serverFn/, /api/) is always network-only. */
const VERSION = "gbpims-v1";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const OFFLINE_HTML =
  "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
  "<title>GBPIMS — offline</title><body style='font:15px/1.5 system-ui;background:#fafafa;color:#111;" +
  "display:grid;place-items:center;min-height:100vh;margin:0'><div style='text-align:center;max-width:24rem;padding:1.5rem'>" +
  "<h1 style='font-size:1.25rem'>You appear to be offline</h1><p style='color:#4b5563'>Reconnect and pull to refresh.</p>" +
  "<button onclick='location.reload()' style='padding:.5rem 1rem;border-radius:.375rem;border:0;background:#111;color:#fff'>Try again</button>";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_serverFn/") || url.pathname.startsWith("/api/")) return;

  // Hashed build assets are immutable → cache-first.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request, { cacheName: ASSETS }).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) caches.open(ASSETS).then((c) => c.put(request, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  // Page navigations → network-first (fresh SSR), cached shell as fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(async () => {
          const cached = (await caches.match(request)) || (await caches.match("/"));
          return cached || new Response(OFFLINE_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
        }),
    );
  }
});
