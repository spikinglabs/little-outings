// Cloudflare Pages Function: /api/taps
// One-tap feedback that needs counting, not reading: facility votes from the chips and "We went".
// Stored in Cloudflare D1 (binding DB), one row per browser, item and question, so a family that
// changes its mind updates its vote instead of adding one. Anything people write (tips, new places,
// reports) still goes to the GitHub inbox, where a person reviews it.
//
//   POST /api/taps   { kind: "fac", item, feature, answer: yes|no|unsure, voter }
//                    { kind: "visit", item, again: yes|maybe|no, good_for: [...], voter }
//                    { kind: "lang", item, answer: none|en|de, voter }   how much German an event needs
//   GET  /api/taps?item=<id>   live counts for one place
//   GET  /api/taps?all=1       counts for every place (read by the nightly build)
//   POST /api/taps?mine=1  { voter }   this browser's own taps, for "Download my data"
//   DELETE /api/taps  { voter }      removes this browser's taps ("Delete my data")
//
// Environment (Cloudflare Pages → Settings → Bindings / Variables):
//   DB        D1 database binding (the table is created on first use)
//   TAP_SALT  optional secret mixed into the hashed IP used for rate limiting
// Without DB it answers 503, and the site falls back to the inbox.

interface D1Stmt { bind(...v: unknown[]): D1Stmt; run(): Promise<unknown>; all<T = any>(): Promise<{ results: T[] }>; first<T = any>(): Promise<T | null> }
export interface D1 { prepare(sql: string): D1Stmt; batch(s: D1Stmt[]): Promise<unknown> }
interface Env { DB?: D1; TAP_SALT?: string }
type Ctx = { request: Request; env: Env };

// Same lists as src/content.config.ts (functions can't import Astro's zod config).
const FEATURES = ["playground", "changing_table", "highchairs", "kids_menu", "toys", "animals", "stroller_friendly",
  "nursing_room", "indoor_play", "toilets", "farm_shop", "parking"];
const LANGUAGE = ["none", "en", "de"];
const GOOD_FOR = ["toddlers", "bigKids", "rainy", "longVisit", "quickHour", "friends"];
/** Taps one connection may send per hour; a family answering every chip on a few places stays far below. */
export const HOURLY_LIMIT = 120;

const json = (status: number, body: unknown, cache = "no-store") =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": cache } });
const ID = /^[a-z0-9-]{1,100}$/;
const VOTER = /^[a-zA-Z0-9-]{8,64}$/;

const ready = new WeakSet<D1>(); // per isolate: create the table once
export async function schema(db: D1) {
  if (ready.has(db)) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS taps (item TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
      voter TEXT NOT NULL, ip TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (item, key, voter))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS taps_ip ON taps (ip, at)`),
  ]);
  ready.add(db);
}

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The rows one tap writes: [key, value]. Null when the tap is malformed. */
export function rowsOf(body: any): { item: string; rows: [string, string][]; clear?: string } | null {
  if (!body || typeof body.item !== "string" || !ID.test(body.item)) return null;
  if (body.kind === "fac" && FEATURES.includes(body.feature) && ["yes", "no", "unsure"].includes(body.answer)) {
    return { item: body.item, rows: [[`fac:${body.feature}`, body.answer]] };
  }
  if (body.kind === "lang" && LANGUAGE.includes(body.answer)) {
    return { item: body.item, rows: [["lang", body.answer]] };
  }
  if (body.kind === "visit" && ["yes", "maybe", "no"].includes(body.again)) {
    const good = [...new Set((Array.isArray(body.good_for) ? body.good_for : []).filter((g: unknown) => GOOD_FOR.includes(g as string)))] as string[];
    // A repeat "We went" from the same browser replaces its earlier chips.
    return { item: body.item, rows: [["visit", body.again], ...good.map((g): [string, string] => [`good:${g}`, "1"])], clear: "good:%" };
  }
  return null;
}

type Count = { item: string; key: string; value: string; n: number };
export type Counts = Record<string, {
  fac?: Record<string, { yes: number; no: number }>;
  visits?: { count: number; again: number; good_for: Record<string, number> };
  lang?: Record<string, number>;
}>;
/** Grouped rows → the same shape the build uses for inbox tallies. */
export function countsFrom(rows: Count[]): Counts {
  const out: Counts = {};
  for (const { item, key, value, n } of rows) {
    const c = (out[item] ??= {});
    if (key.startsWith("fac:") && (value === "yes" || value === "no")) {
      const v = ((c.fac ??= {})[key.slice(4)] ??= { yes: 0, no: 0 });
      v[value] += n;
    } else if (key === "lang") {
      (c.lang ??= {})[value] = (c.lang[value] ?? 0) + n;
    } else if (key === "visit") {
      const v = (c.visits ??= { count: 0, again: 0, good_for: {} });
      v.count += n;
      if (value === "yes") v.again += n;
    } else if (key.startsWith("good:")) {
      const v = (c.visits ??= { count: 0, again: 0, good_for: {} });
      v.good_for[key.slice(5)] = (v.good_for[key.slice(5)] ?? 0) + n;
    }
  }
  return out;
}

export async function onRequestPost({ request, env }: Ctx) {
  if (!env.DB) return json(503, { error: "taps not configured" });
  if (new URL(request.url).searchParams.get("mine") === "1") return mine(request, env.DB);
  if (Number(request.headers.get("content-length") ?? 0) > 4000) return json(413, { error: "too large" });
  let body: any;
  try { body = await request.json(); } catch { return json(400, { error: "invalid json" }); }
  const tap = rowsOf(body);
  if (!tap || typeof body.voter !== "string" || !VOTER.test(body.voter)) return json(400, { error: "unknown tap" });

  const db = env.DB;
  await schema(db);
  const now = Date.now();
  // The IP is only kept hashed, for the hourly limit; the voter id is a random id from the browser.
  const ip = await sha(`${env.TAP_SALT ?? "little-outings"}:${request.headers.get("cf-connecting-ip") ?? ""}`);
  const voter = await sha(body.voter);
  const recent = await db.prepare(`SELECT COUNT(*) AS n FROM taps WHERE ip = ? AND at > ?`).bind(ip, now - 3600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= HOURLY_LIMIT) return json(429, { error: "slow down" });

  const write = db.prepare(`INSERT INTO taps (item, key, value, voter, ip, at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (item, key, voter) DO UPDATE SET value = excluded.value, ip = excluded.ip, at = excluded.at`);
  await db.batch([
    ...(tap.clear ? [db.prepare(`DELETE FROM taps WHERE item = ? AND voter = ? AND key LIKE ?`).bind(tap.item, voter, tap.clear)] : []),
    ...tap.rows.map(([k, v]) => write.bind(tap.item, k, v, voter, ip, now)),
  ]);
  return json(200, { ok: true });
}

export async function onRequestGet({ request, env }: Ctx) {
  if (!env.DB) return json(503, { error: "taps not configured" });
  const url = new URL(request.url);
  const item = url.searchParams.get("item");
  const all = url.searchParams.get("all") === "1";
  if (!all && (!item || !ID.test(item))) return json(400, { error: "item or all=1" });
  await schema(env.DB);
  const sql = `SELECT item, key, value, COUNT(*) AS n FROM taps ${all ? "" : "WHERE item = ?"} GROUP BY item, key, value`;
  const stmt = env.DB.prepare(sql);
  const { results } = await (all ? stmt : stmt.bind(item)).all<Count>();
  const counts = countsFrom(results);
  return json(200, all ? counts : counts[item!] ?? {}, "public, max-age=60");
}

async function voterOf(request: Request) {
  let body: any;
  try { body = await request.json(); } catch { return null; }
  return body && typeof body.voter === "string" && VOTER.test(body.voter) ? sha(body.voter) : null;
}

/** A family's own taps. The voter id stays in the browser, so only that browser can ask. */
async function mine(request: Request, db: D1) {
  const voter = await voterOf(request);
  if (!voter) return json(400, { error: "voter" });
  await schema(db);
  const { results } = await db.prepare(`SELECT item, key, value, at FROM taps WHERE voter = ? ORDER BY at`).bind(voter)
    .all<{ item: string; key: string; value: string; at: number }>();
  return json(200, results.map((r) => ({ item: r.item, question: r.key, answer: r.value, at: new Date(r.at).toISOString() })));
}

export async function onRequestDelete({ request, env }: Ctx) {
  if (!env.DB) return json(503, { error: "taps not configured" });
  const voter = await voterOf(request);
  if (!voter) return json(400, { error: "voter" });
  await schema(env.DB);
  await env.DB.prepare(`DELETE FROM taps WHERE voter = ?`).bind(voter).run();
  return json(200, { ok: true });
}

/**
 * Moves one browser's taps to another voter id (a family signing in with a passkey on a phone that
 * already tapped). Where both answered the same question, the newer answer stays.
 */
export async function moveTaps(db: D1, fromVoter: string, toVoter: string) {
  if (!VOTER.test(fromVoter) || !VOTER.test(toVoter) || fromVoter === toVoter) return;
  await schema(db);
  const [from, to] = [await sha(fromVoter), await sha(toVoter)];
  await db.batch([
    db.prepare(`DELETE FROM taps WHERE voter = ? AND EXISTS (SELECT 1 FROM taps o WHERE o.voter = ? AND o.item = taps.item AND o.key = taps.key AND o.at > taps.at)`).bind(to, from),
    db.prepare(`UPDATE OR IGNORE taps SET voter = ? WHERE voter = ?`).bind(to, from),
    db.prepare(`DELETE FROM taps WHERE voter = ?`).bind(from),
  ]);
}
