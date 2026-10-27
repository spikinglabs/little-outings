// Cloudflare Pages Function: /api/hit
// Anonymous usage counts for a few actions inside the app (saving, opening directions, adding to the
// calendar, installing…). Page views come from Cloudflare Web Analytics; this covers what it can't see.
// Only daily totals are kept: no IP, no browser id, no time of day, nothing that tells two visitors apart.
// That makes them anonymous statistics, so they need no consent banner. Keep it that way.
//
//   POST /api/hit  { e: "save", on: "event" | "place" | "other", lang: "de" }   adds one to today's total
//   GET  /api/hit?days=30                                                       totals per day, newest first
//
// Environment: DB, the same D1 database as /api/taps (the table is created on first use).
// Without DB it answers 204 and counts nothing.
import type { D1 } from "./taps.ts";

interface Env { DB?: D1 }
type Ctx = { request: Request; env: Env };

/** Actions the app counts; anything else is ignored. Add here and in src/lib/count.ts together. */
// copy: the weekend edition's chat text; from_print / from_telegram: someone arrived from the printed
// sheet or the Telegram post (?von=…); from_rednote: someone typed a Rednote card's code into the search box;
// rednote_share: someone tapped "分享到小红书" or "保存图片和文字" (src/components/RednoteShare.astro);
// from_wechat: a visit opened inside WeChat's own browser, once per visit (src/scripts/app.ts).
export const EVENTS = ["save", "maps", "calendar", "website", "share", "install", "copy", "from_print", "from_telegram", "from_rednote", "rednote_share", "from_wechat"];
const ON = ["event", "place", "other"];
const LANGS = ["de", "en", "zh"];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const ready = new WeakSet<D1>();
async function schema(db: D1) {
  if (ready.has(db)) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS hits (day TEXT NOT NULL, event TEXT NOT NULL, kind TEXT NOT NULL,
    lang TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, event, kind, lang))`).run();
  ready.add(db);
}

/** The counter one hit adds to, or null when the hit is not one the app sends. */
export function hitOf(body: any): { event: string; kind: string; lang: string } | null {
  if (!body || !EVENTS.includes(body.e)) return null;
  return { event: body.e, kind: ON.includes(body.on) ? body.on : "other", lang: LANGS.includes(body.lang) ? body.lang : "de" };
}

export async function onRequestPost({ request, env }: Ctx) {
  if (!env.DB) return new Response(null, { status: 204 });
  if (Number(request.headers.get("content-length") ?? 0) > 200) return json(413, { error: "too large" });
  let body: any;
  try { body = JSON.parse(await request.text()); } catch { return json(400, { error: "invalid json" }); }
  const hit = hitOf(body);
  if (!hit) return json(400, { error: "unknown event" });
  await schema(env.DB);
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(`INSERT INTO hits (day, event, kind, lang, n) VALUES (?, ?, ?, ?, 1)
    ON CONFLICT (day, event, kind, lang) DO UPDATE SET n = n + 1`).bind(day, hit.event, hit.kind, hit.lang).run();
  return new Response(null, { status: 204 });
}

export async function onRequestGet({ request, env }: Ctx) {
  if (!env.DB) return json(503, { error: "counts not configured" });
  const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get("days")) || 30, 1), 366);
  const since = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
  await schema(env.DB);
  const { results } = await env.DB.prepare(`SELECT day, event, kind, lang, n FROM hits WHERE day >= ? ORDER BY day DESC, event`)
    .bind(since).all();
  return json(200, results);
}
