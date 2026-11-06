// Cloudflare Pages Function: POST /api/parse
// Reads a poster photo, a link or pasted text and returns a draft event for the parent to check.
// The photo is only passed to the model for this one request; it is never stored or published.
//
// Environment (same switch as the nightly translation, src/lib/llm.ts):
//   GEMINI_API_KEY or ANTHROPIC_API_KEY   with both, Gemini unless LLM_PROVIDER is "anthropic". These are
//                      set in the Pages project (Settings → Variables and Secrets), not taken from GitHub:
//                      set both there, or posters fail whenever Gemini's prepaid credits run out.
//   PARSE_MODEL        optional: a vision-capable model of that provider (its default otherwise)
// Until a key is set, it answers 503 and the form opens empty for typing.
// With both keys, Claude answers whenever Gemini fails for any reason (a parent is waiting), not only
// when Gemini's credits are used up.
//
// Each try is noted in D1 (binding DB, table parse_log, kept 30 days): the day and time, image / url / text,
// read or failed, which provider, and for a failure the reason and the provider's error message. Never the
// poster, the link or the text itself. The admin's Usage panel shows it:
//   GET /api/parse?days=14   with header x-admin-key: <MEETUP_ADMIN_KEY>   counts per day + the last failures
// Each failure is also one line in the Pages Functions log ("parse failed …").
import { complete, pickLlm, type Llm, type LlmEnv } from "../../src/lib/llm.ts";
import type { D1 } from "./taps.ts";
import { isAdmin } from "../../src/lib/admin-key.ts";

interface Env extends LlmEnv { PARSE_MODEL?: string; DB?: D1; MEETUP_ADMIN_KEY?: string }
type Ctx = { request: Request; env: Env };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const KEEP_DAYS = 30;
type Input = "image" | "url" | "text";
/** Why one try failed. no_credits: the provider's credits or quota are used up (HTTP 402/429). */
export type Reason = "no_credits" | "provider_error" | "empty_answer" | "unreadable_answer" | "link_failed";
type Note = { input: Input; ok: boolean; provider?: string; reason?: Reason; detail?: string; ms: number };

const ready = new WeakSet<D1>();
async function schema(db: D1) {
  if (ready.has(db)) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS parse_log (at INTEGER NOT NULL, input TEXT NOT NULL, ok INTEGER NOT NULL,
      provider TEXT, reason TEXT, detail TEXT, ms INTEGER NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS parse_log_at ON parse_log (at)`),
  ]);
  ready.add(db);
}

/** Notes one try; never fails the answer to the parent. */
async function note(env: Env, n: Note) {
  if (!n.ok) console.error(`parse failed input=${n.input} provider=${n.provider ?? "-"} reason=${n.reason} ms=${n.ms}: ${n.detail ?? ""}`);
  if (!env.DB) return;
  try {
    await schema(env.DB);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO parse_log (at, input, ok, provider, reason, detail, ms) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(now, n.input, n.ok ? 1 : 0, n.provider ?? null, n.reason ?? null, n.detail?.slice(0, 300) ?? null, n.ms),
      env.DB.prepare(`DELETE FROM parse_log WHERE at < ?`).bind(now - KEEP_DAYS * 864e5),
    ]);
  } catch (e) { console.error("parse: could not note the try", e); }
}

export const reasonOf = (e: unknown): Reason => {
  const m = (e as Error)?.message ?? "";
  if (/^\w+: HTTP (402|429)\b/.test(m)) return "no_credits";
  if (/empty answer/.test(m)) return "empty_answer";
  return "provider_error";
};

/** For the admin: tries per day and input, and the last failures with their reasons. */
export async function onRequestGet({ request, env }: Ctx) {
  if (!(await isAdmin(request, env))) return json(403, { error: "admin key needed" });
  if (!env.DB) return json(503, { error: "no database" });
  await schema(env.DB);
  const days = Math.min(KEEP_DAYS, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 14));
  const since = Date.now() - days * 864e5;
  const day = `strftime('%Y-%m-%d', at / 1000, 'unixepoch')`;
  const [counts, failures] = await Promise.all([
    env.DB.prepare(`SELECT ${day} AS day, input, ok, provider, COUNT(*) AS n FROM parse_log WHERE at >= ?
      GROUP BY day, input, ok, provider ORDER BY day DESC`).bind(since).all(),
    env.DB.prepare(`SELECT at, input, provider, reason, detail, ms FROM parse_log WHERE at >= ? AND ok = 0
      ORDER BY at DESC LIMIT 20`).bind(since).all(),
  ]);
  return json(200, { days, counts: counts.results, failures: failures.results });
}

const FIELDS = ["title", "date", "time", "place", "price", "note"];
const PROMPT = `You read announcements of family events in Germany (posters, web pages, chat messages).
Return only JSON: {"draft":{"title":"","date":"YYYY-MM-DD","time":"","place":"","price":"","note":""},"unsure":[]}.
- title: a short neutral title in your own words, in German. Do not copy slogans.
- date: the first day; assume the next upcoming occurrence if the year is missing. Today is {today}.
- time: like "14:00–17:00". place: venue and address or town. price: as written, or "kostenlos".
- note: one or two sentences about what there is for children, in German.
- unsure: names of fields you guessed or could not read. Leave unknown fields empty.`;

export async function onRequestPost({ request, env }: Ctx) {
  const llm = pickLlm(env);
  if (!llm) return json(503, { error: "parsing not configured" });
  let body: any;
  try { body = await request.json(); } catch { return json(400, { error: "invalid json" }); }
  const started = Date.now();
  let kind: Input;

  let image: { mediaType: string; data: string } | undefined, input: string | undefined;
  if (typeof body.image === "string" && body.image.length < 7_000_000 && /^image\/(jpeg|png|webp|gif)$/.test(body.mediaType)) {
    kind = "image";
    image = { mediaType: body.mediaType, data: body.image };
  } else if (typeof body.url === "string" && /^https?:\/\//.test(body.url)) {
    kind = "url";
    const page = await fetch(body.url, { headers: { "user-agent": "little-outings parser" } }).catch(() => null);
    if (!page?.ok) {
      await note(env, { input: kind, ok: false, reason: "link_failed", detail: page ? `HTTP ${page.status}` : "no answer", ms: Date.now() - started });
      return json(422, { error: "could not load link", reason: "link_failed" });
    }
    const text = (await page.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 20000);
    input = `Web page ${body.url}:\n${text}`;
  } else if (typeof body.text === "string" && body.text.trim()) {
    kind = "text";
    input = body.text.slice(0, 8000);
  } else {
    return json(400, { error: "send image, url or text" });
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  const ask = { system: PROMPT.replace("{today}", today), text: input, image, maxTokens: 4000, json: true };
  // 500, not 502: Cloudflare swaps a 502 body for its own "error code: 502", which hid the reason.
  const fail = async (reason: Reason, provider: string, detail: string) => {
    await note(env, { input: kind, ok: false, provider, reason, detail, ms: Date.now() - started });
    return json(500, { error: "could not read it", reason });
  };

  let text: string;
  let used: Llm = llm;
  try {
    text = await complete(llm, env.PARSE_MODEL, ask);
  } catch (e) {
    // complete() already moved to Claude when Gemini's credits are gone; any other Gemini error gets Claude too.
    const fallback = llm.fallback;
    if (!fallback) return fail(reasonOf(e), llm.provider, (e as Error).message);
    console.error(`parse: ${llm.provider} failed, asking ${fallback.provider}: ${(e as Error).message.slice(0, 300)}`);
    try {
      used = fallback;
      text = await complete(fallback, undefined, ask);
    } catch (e2) {
      return fail(reasonOf(e2), `${llm.provider}+${fallback.provider}`, `${(e as Error).message.slice(0, 140)} | ${(e2 as Error).message.slice(0, 140)}`);
    }
  }
  try {
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const draft = Object.fromEntries(FIELDS.map((k) => [k, String(parsed.draft?.[k] ?? "").slice(0, 2000)]));
    const unsure = (parsed.unsure ?? []).filter((k: string) => FIELDS.includes(k));
    await note(env, { input: kind, ok: true, provider: used.provider, ms: Date.now() - started });
    return json(200, { draft, unsure });
  } catch {
    return fail("unreadable_answer", used.provider, text.slice(0, 300));
  }
}
