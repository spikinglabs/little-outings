// Tells Bing (and Yandex, Seznam, Naver) about new pages through IndexNow, run after each production deploy.
// Bing's index is what ChatGPT search, Copilot and DuckDuckGo answer from, and the site wasn't in it.
// The key is public on purpose: IndexNow checks that https://<host>/<key>.txt holds it (public/<key>.txt).
// Sends each sitemap URL once (remembered in INDEXNOW_SENT, kept between runs by the Actions cache), and
// every run the pages that change on their own: the home pages, weekend picks and anything with today's lastmod.
// The first run, with nothing remembered, sends the whole sitemap. Never fails the build.
//
//   npm run indexnow            (reads dist/sitemap.xml; DRY=1 prints instead of sending)
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const KEY = "0c0da7045bad6d7621f1ddd384ada6a0";
const ENDPOINT = "https://api.indexnow.org/indexnow";
const BATCH = 10000; // IndexNow takes at most 10,000 URLs per request

/** sitemap.xml → [{ loc, lastmod }] */
export function sitemapUrls(xml) {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, u]) => ({
    loc: u.match(/<loc>([^<]+)<\/loc>/)?.[1] ?? "",
    lastmod: u.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? "",
  })).filter((u) => u.loc);
}

/** Pages whose content moves without their URL changing. */
export const changesOften = (loc) => /^https:\/\/[^/]+\/(de|en|zh)\/(wochenende\/.*)?$/.test(loc);

/** The URLs to send this run: not sent before, or changing often, or modified today. */
export function toSend(urls, sent, today) {
  return urls.filter((u) => !sent.has(u.loc) || changesOften(u.loc) || u.lastmod.startsWith(today)).map((u) => u.loc);
}

async function main() {
  const file = process.env.SITEMAP || "dist/sitemap.xml";
  const sentFile = process.env.INDEXNOW_SENT || ".cache/indexnow-sent.txt";
  const urls = sitemapUrls(readFileSync(file, "utf8"));
  const sent = new Set(existsSync(sentFile) ? readFileSync(sentFile, "utf8").split("\n").filter(Boolean) : []);
  const today = new Date().toISOString().slice(0, 10);
  const list = toSend(urls, sent, today);
  if (!list.length) return console.log("IndexNow: nothing new");
  const host = new URL(list[0]).host;
  let ok = 0;
  for (let i = 0; i < list.length; i += BATCH) {
    const urlList = list.slice(i, i + BATCH);
    if (process.env.DRY) { console.log(urlList.slice(0, 20).join("\n")); ok += urlList.length; continue; }
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key: KEY, keyLocation: `https://${host}/${KEY}.txt`, urlList }),
    }).catch((e) => ({ ok: false, status: e.message }));
    // 200 and 202 both mean taken; 202 while the key is still being checked.
    if (res.ok) { ok += urlList.length; urlList.forEach((u) => sent.add(u)); }
    else console.log(`IndexNow: batch of ${urlList.length} refused (${res.status})`);
  }
  if (!process.env.DRY) writeFileSync(sentFile, [...sent].join("\n") + "\n");
  console.log(`IndexNow: sent ${ok} of ${list.length} URLs (${urls.length} in the sitemap)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => console.log(`IndexNow: ${e.message}`));
