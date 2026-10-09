// Little Outings service worker: makes the site installable and keeps pages you opened readable offline.
//   pages        → network first, fall back to the copy from your last visit
//   /_astro/, icons, fonts → cache first (file names change when the content does)
//   /api/, /admin/ and anything not GET → straight to the network, never cached
const VERSION = "v1";
const PAGES = `pages-${VERSION}`;
const STATIC = `static-${VERSION}`;
const MAX_PAGES = 80;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = [PAGES, STATIC];
    for (const key of await caches.keys()) if (!keep.includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin !== self.location.origin && !fonts) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin/")) return;

  if (fonts || url.pathname.startsWith("/_astro/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(req));
  } else {
    event.respondWith(networkFirst(req, url));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}

async function networkFirst(req, url) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic") {
      await cache.put(req, res.clone());
      trim(cache);
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === "navigate") {
      // Offline on a page you haven't opened yet: show the start page in your language, if we have it.
      const lang = (url.pathname.match(/^\/(de|en|zh)\//) || [])[1] || "de";
      const home = (await cache.match(`/${lang}/`)) || (await cache.match("/de/"));
      if (home) return home;
      return new Response(OFFLINE, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    throw err;
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) await cache.delete(key);
}

const OFFLINE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Little Outings</title><style>body{font:1.05rem/1.5 system-ui,sans-serif;background:#f6f5f2;color:#17191b;margin:0;padding:48px 20px;text-align:center}
b{display:inline-block;background:#ffcc00;padding:4px 10px;border-radius:8px;margin-bottom:12px}</style></head>
<body><b>Little Outings · 小出游</b><p>Offline. Bitte später nochmal versuchen.<br>You're offline. Please try again later.<br>当前离线，请稍后再试。</p></body></html>`;
