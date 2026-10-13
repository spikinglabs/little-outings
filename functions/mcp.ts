// Cloudflare Pages Function: /mcp, the Little Outings connector for AI assistants (Model Context Protocol).
// Parents add https://outings.allo.land/mcp as a custom connector in Claude, ChatGPT or another
// assistant, then ask for outings in their own words. No login: it's the same public data as the site.
//
// Streamable HTTP without sessions: every POST is one JSON-RPC message, answered with plain JSON.
// Tools:
//   search, fetch          find events and places, read one in full (names ChatGPT's connectors expect)
//   suggest_event, suggest_place, add_tip, report_problem
//                          go to the same reviewed inbox as the site's forms (functions/api/inbox.ts),
//                          labelled "via-ai"; nothing is published until a moderator approves it.
// Assistants call from their own servers, so many parents share one IP: written suggestions are capped
// for all assistants together (WRITE_LIMITS), counted in D1.
//
// Environment: ASSETS (always there), and for the writing tools the inbox's GITHUB_TOKEN and INBOX_REPO
// plus DB, the D1 database /api/taps uses. Without them the writing tools say they aren't set up.
import { details, EVENT_TAGS, FACILITIES, loadIndex, loadItem, PLACE_KINDS, search, type Assets, type Lang } from "../src/lib/search.ts";
import { fileIssue, issueOf, type Env as InboxEnv } from "./api/inbox.ts";
import type { D1 } from "./api/taps.ts";

interface Env extends InboxEnv { ASSETS: { fetch: (r: Request | string) => Promise<Response> }; DB?: D1 }
type Ctx = { request: Request; env: Env };

/** Suggestions from all assistants together, per hour and per day; the site's own forms don't count. */
export const WRITE_LIMITS = { hour: 30, day: 150 };
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const LANGS = ["de", "en", "zh"];
const TIP_TOPICS = ["bring", "bestTime", "parking", "ages", "other"];
const REASONS = ["closed", "cancelled", "where", "notKids", "outdated", "other"];

const INSTRUCTIONS = `Little Outings (outings.allo.land) lists family events for children and kid-friendly places (playgrounds, pools, farms, zoos, museums, family cafés …) around Cologne, Düsseldorf, Bonn, Aachen and the Bergisches Land, and in Berlin, Munich, Frankfurt and Hamburg, Germany.
Use search to find ideas for a town and dates, then fetch for details. Always give parents the page link (url) and remind them to check with the organiser; facilities not listed are unknown, not missing.
Parents can add what they know: suggest_event, suggest_place, add_tip and report_problem send it to a moderator for review. Only send what the parent asked you to send, and show them what you'll send first.`;

const lang = { type: "string", enum: LANGS, description: "Language for titles and links: de, en or zh. Default en." };
const TOOLS = [
  {
    name: "search",
    title: "Find family outings",
    description: `Find events for kids and kid-friendly places near a town in western Germany. Returns up to 50 short results with an id (for fetch) and a link.
Events are filtered to the dates given (default: today and the next 6 days); places are always open-ended. Results include "today", so you can work out dates like "this Saturday".
Place kinds: ${PLACE_KINDS.join(", ")}. Event kinds: ${EVENT_TAGS.join(", ")}.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text, e.g. \"puppet theatre\" or \"playground with sandpit in Cologne this weekend\". Town names, today/tomorrow/weekend and kind words are understood." },
        town: { type: "string", description: "A town such as Köln (Cologne), Düsseldorf, Bonn, Aachen, Wuppertal, Leverkusen, Essen." },
        lat: { type: "number" }, lon: { type: "number" },
        radius_km: { type: "number", description: "Around the town or point, default 10, at most 100." },
        from: { type: "string", description: "First day, YYYY-MM-DD." },
        to: { type: "string", description: "Last day, YYYY-MM-DD." },
        what: { type: "string", enum: ["events", "places", "all"], description: "Default all." },
        kinds: { type: "array", items: { type: "string" }, description: "Place kinds and/or event kinds to keep." },
        indoor: { type: "boolean", description: "true for rainy-day ideas. Mostly a guess from the kind (museum, theatre …), so mention that." },
        free: { type: "boolean", description: "Only free ones." },
        needs: { type: "array", items: { type: "string", enum: FACILITIES }, description: "Places only: facilities parents confirmed, e.g. changing_table, highchairs, sandpit." },
        lang,
        limit: { type: "number", description: "Default 20, at most 50." },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "fetch",
    title: "Read one outing",
    description: "Full details of one event or place by its id from search: dates and time, address, price, opening hours, confirmed facilities, parents' tips, website and page link.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, lang }, required: ["id"] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "suggest_event",
    title: "Suggest an event",
    description: "Send a family event that isn't listed yet (e.g. from a poster or newsletter the parent shared). A moderator checks it before it appears. Confirm the details with the parent first.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD, the first day." },
        time: { type: "string", description: "e.g. 15:00 or 10–17 Uhr." },
        place: { type: "string", description: "Venue and address, or at least the town." },
        price: { type: "string", description: "e.g. free, 5 €." },
        note: { type: "string", description: "What happens, ages, end date, website or where it was announced." },
        lang,
      },
      required: ["title", "date", "place"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "suggest_place",
    title: "Suggest a place",
    description: "Send a kid-friendly place that isn't listed yet. A moderator checks it before it appears. Confirm the details with the parent first.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        kind: { type: "string", enum: PLACE_KINDS },
        town: { type: "string" },
        street: { type: "string", description: "Street and number." },
        website: { type: "string" },
        features: { type: "array", items: { type: "string", enum: FACILITIES }, description: "Facilities the parent has seen there." },
        note: { type: "string" },
        lang,
      },
      required: ["name", "kind", "town"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "add_tip",
    title: "Add a parent's tip",
    description: "A short \"good to know\" tip about a listed event or place, from the parent's own visit (at most 140 characters). Shown after a moderator approves it.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The id from search." },
        topic: { type: "string", enum: TIP_TOPICS, description: "bring (what to bring), bestTime, parking, ages or other." },
        text: { type: "string", maxLength: 140 },
        lang,
      },
      required: ["id", "topic", "text"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "report_problem",
    title: "Report a problem",
    description: "Tell the moderators a listing is wrong: closed, cancelled, wrong place (where), not for kids (notKids), outdated or other.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, reason: { type: "string", enum: REASONS }, note: { type: "string" }, lang },
      required: ["id", "reason"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" } });

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };
const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const out = (value: unknown, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1) }], ...(isError ? { isError } : {}) });

class ToolError extends Error {}
const str = (v: unknown, name: string, required = false) => {
  if (v === undefined || v === null || v === "") { if (required) throw new ToolError(`${name} is required`); return undefined; }
  if (typeof v !== "string") throw new ToolError(`${name} must be text`);
  return v;
};
const langOf = (v: unknown): Lang => (LANGS.includes(v as string) ? (v as Lang) : "en");

/** Counts one written suggestion against WRITE_LIMITS; false when the limit is reached. */
export async function allowWrite(db: D1, now = Date.now()): Promise<boolean> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS ai_writes (at INTEGER NOT NULL)`).run();
  const counts = await db.prepare(`SELECT SUM(at > ?) AS hour, COUNT(*) AS day FROM ai_writes WHERE at > ?`)
    .bind(now - 3600_000, now - 86400_000).first<{ hour: number | null; day: number }>();
  if ((counts?.hour ?? 0) >= WRITE_LIMITS.hour || (counts?.day ?? 0) >= WRITE_LIMITS.day) return false;
  await db.batch([
    db.prepare(`DELETE FROM ai_writes WHERE at < ?`).bind(now - 86400_000),
    db.prepare(`INSERT INTO ai_writes (at) VALUES (?)`).bind(now),
  ]);
  return true;
}

async function callTool(name: string, args: any, env: Env, origin: string) {
  const assets: Assets = (path) => env.ASSETS.fetch(new URL(path, origin).toString());
  const a = args && typeof args === "object" ? args : {};
  const l = langOf(a.lang);
  if (name === "search") {
    const index = await loadIndex(assets);
    const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",").map((s) => s.trim()) : undefined);
    const bool = (v: unknown) => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined);
    return out(search(index, {
      q: str(a.query ?? a.q, "query"), town: str(a.town, "town"), lat: a.lat, lon: a.lon, radius_km: a.radius_km,
      from: str(a.from, "from"), to: str(a.to, "to"), what: a.what, kinds: list(a.kinds), indoor: bool(a.indoor), free: bool(a.free),
      needs: list(a.needs), lang: l, limit: a.limit,
    }, origin));
  }
  if (name === "fetch") {
    const id = str(a.id, "id", true)!;
    const [index, item] = await Promise.all([loadIndex(assets), loadItem(assets, id)]);
    if (!item) throw new ToolError(`No event or place with id "${id}". Past events drop off every night; search again.`);
    return out(details(item, l, origin, index.towns));
  }

  // Writing tools: shape the same contribution the site's forms send, then file it.
  let body: Record<string, unknown>;
  if (name === "suggest_event") {
    body = { kind: "event", lang: l, draft: {
      title: str(a.title, "title", true), date: str(a.date, "date", true), time: str(a.time, "time"),
      place: str(a.place, "place", true), price: str(a.price, "price"), note: str(a.note, "note"),
    } };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.date))) throw new ToolError("date must be YYYY-MM-DD");
  } else if (name === "suggest_place") {
    if (!PLACE_KINDS.includes(a.kind)) throw new ToolError(`kind must be one of ${PLACE_KINDS.join(", ")}`);
    body = { kind: "place", lang: l, place: {
      name: str(a.name, "name", true), kind: a.kind, town: str(a.town, "town", true), street: str(a.street, "street"),
      website: str(a.website, "website"), note: str(a.note, "note"), features: Array.isArray(a.features) ? a.features.filter((f: unknown) => FACILITIES.includes(f as string)) : [],
    } };
  } else if (name === "add_tip") {
    if (!TIP_TOPICS.includes(a.topic)) throw new ToolError(`topic must be one of ${TIP_TOPICS.join(", ")}`);
    const text = str(a.text, "text", true)!.trim();
    if (text.length > 140) throw new ToolError("text must be at most 140 characters; shorten it");
    body = { kind: "tip", lang: l, item: str(a.id, "id", true), topic: a.topic, text };
  } else if (name === "report_problem") {
    if (!REASONS.includes(a.reason)) throw new ToolError(`reason must be one of ${REASONS.join(", ")}`);
    body = { kind: "report", lang: l, item: str(a.id, "id", true), reason: a.reason, note: str(a.note, "note") ?? "" };
  } else {
    return null;
  }
  if (body.item && !(await loadItem(assets, String(body.item)))) throw new ToolError(`No event or place with id "${body.item}"; use the id from search.`);
  const made = await issueOf(body);
  if ("error" in made) throw new ToolError(made.error);
  if (!env.GITHUB_TOKEN || !env.INBOX_REPO || !env.DB) return out("Sending suggestions isn't set up yet. The parent can use the site's Contribute page instead.", true);
  if (!(await allowWrite(env.DB))) return out("Little Outings has had many suggestions from assistants in the last hour. Please try again later, or use the site's Contribute page.", true);
  const number = await fileIssue(env, made.title, [made.label, "via-ai"], made.yaml);
  if (number === null) return out("The inbox didn't answer. Please try again later.", true);
  return out({ ok: true, message: "Thanks! A moderator will look at it before it appears on Little Outings.", ...(number ? { reference: number } : {}) });
}

async function handle(msg: Rpc, env: Env, origin: string) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(msg?.id, -32600, "Invalid request");
  const notification = msg.id === undefined;
  let result: unknown;
  switch (msg.method) {
    case "initialize": {
      const asked = msg.params?.protocolVersion;
      result = {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "little-outings", title: "Little Outings", version: "1.0.0", websiteUrl: origin },
        instructions: INSTRUCTIONS,
      };
      break;
    }
    case "ping": result = {}; break;
    case "tools/list": result = { tools: TOOLS }; break;
    case "tools/call": {
      try {
        result = await callTool(msg.params?.name, msg.params?.arguments, env, origin);
        if (result === null) return fail(msg.id, -32602, `Unknown tool: ${msg.params?.name}`);
      } catch (e) {
        if (!(e instanceof ToolError)) console.error(e);
        result = out(e instanceof ToolError ? e.message : "Something went wrong on Little Outings' side. Please try again.", true);
      }
      break;
    }
    default:
      if (notification) return null; // notifications/initialized, cancelled …: nothing to answer
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
  return notification ? null : ok(msg.id, result);
}

export async function onRequestPost({ request, env }: Ctx) {
  if (Number(request.headers.get("content-length") ?? 0) > 100_000) return reply(fail(null, -32600, "Request too large"), 413);
  let body: Rpc | Rpc[];
  try { body = await request.json(); } catch { return reply(fail(null, -32700, "Parse error"), 400); }
  const origin = new URL(request.url).origin;
  if (Array.isArray(body)) {
    const answers = (await Promise.all(body.slice(0, 20).map((m) => handle(m, env, origin)))).filter(Boolean);
    return answers.length ? reply(answers) : new Response(null, { status: 202, headers: cors });
  }
  const answer = await handle(body, env, origin);
  return answer ? reply(answer) : new Response(null, { status: 202, headers: cors });
}

// A person who opens the address in a browser gets a short page on how to add it; an MCP client asking
// for a server-to-client stream gets 405, since there are no streams or sessions.
const HELP: Record<"de" | "en" | "zh", { title: string; intro: string; steps: string[]; ask: string; site: string; copy: string }> = {
  en: {
    title: "Little Outings in your AI assistant",
    intro: "This address is for AI assistants, not for the browser. Add it to your assistant once, then ask it for family outings.",
    steps: ["Claude: Settings → Connectors → Add custom connector, and paste the address.",
      "ChatGPT: turn on developer mode in Settings, then add a connector (app) with the address.",
      "No login needed. Some assistants need a paid plan for custom connectors."],
    ask: "Then ask, for example: “Anything indoors for a 3-year-old in Cologne this Saturday?”",
    site: "Open Little Outings",
    copy: "Copy",
  },
  de: {
    title: "Little Outings in deinem KI-Assistenten",
    intro: "Diese Adresse ist für KI-Assistenten, nicht für den Browser. Füge sie einmal in deinem Assistenten hinzu und frag ihn dann nach Ausflügen mit Kindern.",
    steps: ["Claude: Einstellungen → Konnektoren → Eigenen Konnektor hinzufügen, Adresse einfügen.",
      "ChatGPT: In den Einstellungen den Entwicklermodus einschalten, dann einen Konnektor (App) mit der Adresse anlegen.",
      "Ohne Anmeldung. Manche Assistenten brauchen für eigene Konnektoren ein Bezahl-Abo."],
    ask: "Dann frag zum Beispiel: „Was gibt es diesen Samstag in Köln drinnen für eine Dreijährige?“",
    site: "Little Outings öffnen",
    copy: "Kopieren",
  },
  zh: {
    title: "在 AI 助手里使用小出游",
    intro: "这个地址是给 AI 助手用的，不是在浏览器里打开的。在助手里添加一次，之后就可以直接问它带孩子去哪儿玩。",
    steps: ["Claude：设置 → 连接器 → 添加自定义连接器，粘贴这个地址。",
      "ChatGPT：在设置里打开开发者模式，然后用这个地址添加连接器（应用）。",
      "无需登录。部分助手的自定义连接器需要付费订阅。"],
    ask: "然后可以问：“这个周六科隆有什么适合三岁孩子的室内活动？”",
    site: "打开小出游",
    copy: "复制",
  },
};

export function helpPage(request: Request) {
  const url = new URL(request.url);
  const wanted = (request.headers.get("accept-language") ?? "").toLowerCase();
  const lang = (["de", "zh", "en"] as const).map((l) => [l, wanted.indexOf(l)] as const).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1])[0]?.[0] ?? "en";
  const h = HELP[lang];
  const address = `${url.origin}/mcp`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${h.title}</title><style>
:root{--paper:#f6f5f2;--card:#fff;--ink:#17191b;--soft:#5b6066;--line:#dddbd5;--gold:#ffcc00;--braun:#6f4a2a}
@media (prefers-color-scheme:dark){:root{--paper:#141517;--card:#1e2023;--ink:#f1efea;--soft:#a9adb2;--line:#33363a}}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.5 system-ui,sans-serif}
main{max-width:34rem;margin:0 auto;padding:2rem 16px}h1{font-size:1.5rem;line-height:1.2;border-left:6px solid var(--gold);padding-left:.6rem}
.addr{display:flex;gap:.5rem;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.6rem .8rem;margin:1rem 0}
.addr code{flex:1;overflow-wrap:anywhere;font-size:1rem}button{font:inherit;border:0;border-radius:8px;background:var(--gold);color:#17191b;padding:.4rem .8rem;font-weight:600}
li{margin:.4rem 0}a{color:inherit}.soft{color:var(--soft)}</style></head><body><main>
<h1>${h.title}</h1><p>${h.intro}</p>
<div class="addr"><code id="a">${address}</code><button type="button" onclick="navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('a').textContent).then(()=>{this.textContent='✓'})">${h.copy}</button></div>
<ol>${h.steps.map((s) => `<li>${s}</li>`).join("")}</ol><p>${h.ask}</p>
<p><a href="/${lang}/">${h.site} →</a></p></main></body></html>`;
}

export const onRequestGet = ({ request }: { request: Request }) => {
  if ((request.headers.get("accept") ?? "").includes("text/html")) {
    return new Response(helpPage(request), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", vary: "accept, accept-language" } });
  }
  return new Response("Little Outings connector for AI assistants (MCP). Add this address as a custom connector in your assistant.", {
    status: 405, headers: { ...cors, allow: "POST, OPTIONS", "content-type": "text/plain; charset=utf-8" },
  });
};
export const onRequestDelete = () => new Response(null, { status: 405, headers: { ...cors, allow: "POST, OPTIONS" } });
export const onRequestOptions = () => new Response(null, { status: 204, headers: cors });
