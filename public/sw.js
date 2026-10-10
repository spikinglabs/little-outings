// Little Outings service worker: makes the site installable and keeps pages you opened readable offline.
//   pages        → a copy saved in the last 12 hours opens at once and is refreshed in the background;
//                  otherwise network first, falling back after 3 s to the older copy
//                  (the fresh one still lands in the cache for next time)
//                  A saved page is only reused while the styles and scripts it names are saved too.
//                  Add, Profile and invites (/m/<id>) always ask the network first: an old copy there would
//                  send with an older build's form (before PR 40, places were sent without an edit key),
//                  or show an invite as it was hours ago.
//   /_astro/, icons, fonts → cache first (file names change when the content does). Only real
//                  CSS/JS/images are kept: the host answers a missing old file with a 200 HTML page.
//   /api/, /admin/ and anything not GET → straight to the network, never cached
const VERSION = "v6";
const FRESH_MS = 12 * 60 * 60 * 1000;
const PAGES = `pages-${VERSION}`;
const STATIC = `static-${VERSION}`;
const MAX_PAGES = 80;
// Pages whose forms send or change what a family contributed, and invites.
const LIVE = /^\/((de|en|zh)\/(mitmachen|profil|treffen)\/?|m\/[a-z2-9]{10}\/?)$/;

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
    event.respondWith(networkFirst(req, url, event));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.type === "opaque" || (res.ok && !isHtml(res))) cache.put(req, res.clone());
  return res;
}

const isHtml = (res) => (res.headers.get("content-type") || "").includes("text/html");
// The /_astro/ files a page links to; their names change with every build that changes them.
const assetsOf = (html) => [...new Set(html.match(/\/_astro\/[^"'\s)]+\.(?:css|js)/g) || [])];

/** True when every style and script the saved page names is saved too, so it can render on its own. */
async function complete(page) {
  const statics = await caches.open(STATIC);
  for (const a of assetsOf(await page.clone().text())) if (!(await statics.match(a))) return false;
  return true;
}

/** Saves the styles and scripts a freshly fetched page names, so its saved copy works later. */
async function saveAssets(page) {
  const statics = await caches.open(STATIC);
  for (const a of assetsOf(await page.text())) {
    if (await statics.match(a)) continue;
    const res = await fetch(a).catch(() => null);
    if (res && res.ok && !isHtml(res)) await statics.put(a, res);
  }
}

async function networkFirst(req, url, event) {
  const cache = await caches.open(PAGES);
  const fresh = fetch(req).then(async (res) => {
    if (res.ok && res.type === "basic") {
      await cache.put(req, res.clone());
      if (isHtml(res)) event.waitUntil(saveAssets(res.clone()).catch(() => {}));
      trim(cache);
    }
    return res;
  });
  try {
    // Opening the app on a weak connection shouldn't wait on the network when a copy is at hand.
    let cached = await cache.match(req, { ignoreSearch: true });
    // A copy from an older build whose styles are gone would show up unstyled: wait for the network.
    if (cached && isHtml(cached) && !(await complete(cached))) cached = undefined;
    if (!cached) return await fresh;
    // Data changes at most a few times a day, so a recent copy is good enough to show right away.
    const age = Date.now() - Date.parse(cached.headers.get("date") || "");
    if (age < FRESH_MS && !LIVE.test(url.pathname)) {
      event.waitUntil(fresh.catch(() => {}));
      return cached;
    }
    const slow = new Promise((ok) => setTimeout(ok, 3000, cached));
    // Let the fresh copy finish downloading into the cache even if the cached one answered first.
    event.waitUntil(fresh.catch(() => {}));
    return await Promise.race([fresh, slow]);
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
