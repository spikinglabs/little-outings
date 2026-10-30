// City alerts: asks the AI which rare city events parents should know about before they go out (a big
// demo or march, an evacuation, a transit strike), every night before the deploy (.github/workflows/translate.yml).
//
// Reads spikinglabs/city-anomalies' public export (facts only: title, city, day, time, place, link), plus
// the earlier verdicts the workflow downloaded from the Allo Outings bucket. Two steps per new alert:
//   1. screen: the model reads the facts of many at once and keeps the few that could matter to families;
//   2. detail: for each kept one it reads the official page (a police release) and writes the day, times
//      and one short line per language.
// Writes
//   ALERTS_DIR/alerts.json  every verdict, uploaded back to the bucket so the admin's "City alerts" panel lists them
//   data/alerts.json        the alerts someone confirmed in the admin (alert-decisions.json) that are not over yet
// Nothing reaches the site without a person's Confirm in the admin.
//
//   GEMINI_API_KEY=… npm run check:alerts      (or ANTHROPIC_API_KEY; see src/lib/llm.ts for the switch)
//   ALERTS_EXPORT=…   the export to read, a URL or a file (default: city-anomalies' main branch)
//   ALERTS_MODEL=…    optional; the provider's default otherwise
//   ALERTS_LIMIT=…    new alerts screened per night at most (default 600)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { complete, pickLlm } from "../src/lib/llm.ts";
import { eachLimit } from "../src/lib/pool.ts";
import { pageText } from "./find-venues.mjs";
import { confirmedAlerts } from "../admin/lib/alerts.js";

const DIR = process.env.ALERTS_DIR || ".cache/outings";
const PUBLISHED = process.env.ALERTS_FILE || "data/alerts.json";
const EXPORT = process.env.ALERTS_EXPORT || "https://raw.githubusercontent.com/spikinglabs/city-anomalies/main/exports/records.jsonl";
const LIMIT = Number(process.env.ALERTS_LIMIT) || 600;
const BATCH = 40;
const AT_ONCE = 4;
const AHEAD = 14; // days: alerts further out wait for a later night
const RECENT = 10; // days: a release without a date counts while it is this fresh
const PAGE_MAX = 6000; // characters of the official page the model reads

/** Bump when the rules below change: open verdicts from an older version are asked again. */
export const PROMPT_VERSION = 1;

export const SCREEN = `You help "Allo Outings", a website where parents in Germany find outings with their children.
You get a JSON list of city notices from official sources: police press releases, the list of registered assemblies, transit notices. Most are German.
Decide for each if parents going out with children in that city should know about it:
- "yes": things that change a family's day in town: large demonstrations, marches and rallies in the centre or along main roads (expect hundreds or more, or a march route), big police operations around public events, evacuations and bomb defusals, closures of central squares, streets, bridges or stations, transit strikes and big disruptions of buses and trains, strikes at day-care centres, events with very large crowds.
- "no": small vigils, info stands and assemblies of a few dozen people, assemblies in remote spots, routine crime reports, traffic accidents and motorway closures, wanted notices, anything already over.
- "unsure": only when you really can't tell.
Return only JSON: {"answers": [{"i": 0, "f": "yes"}, ...]} with one answer per notice, f being "yes", "no" or "unsure".`;

export const DETAIL = `You write short notices for "Allo Outings", a website where parents in Germany find outings with their children.
You get one city notice (facts from an official source) and, when there is one, the text of the official page.
Answer with only JSON:
{"relevant": "yes" | "no" | "unsure", "day": "YYYY-MM-DD", "until": "YYYY-MM-DD" (only if it lasts several days), "from": "HH:MM", "to": "HH:MM", "where": "short place or route", "line": {"de": "…", "en": "…", "zh": "…"}}
- "relevant": "yes" if parents out with children that day should know (crowds, closures, diverted trams and buses, police operations), "no" if not after all.
- day, from, to, where: only what the notice or page says; leave a key out when it doesn't say.
- line: one sentence per language, at most 140 characters: what happens, where, and what it means for getting around (closures, detours, crowds). Facts only, from the notice and page.
  No reassurance ("no need to worry", "the police expect it to stay peaceful"), no advice on how to plan the day, no opinion on the cause, no names of private persons.
  German for "de", English for "en", Simplified Chinese for "zh" (keep German street and place names as they are).`;

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (day, n) => iso(new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5));

/** The day a record is about: its start date, or the day it was published when it has none. */
export const dayOf = (rec) => rec.start_date || (rec.published || "").slice(0, 10) || null;

/** Records worth asking about: in the next AHEAD days (or freshly published without a date), not asked yet. */
export function toCheck(records, items, today) {
  const last = addDays(today, AHEAD);
  const oldest = addDays(today, -RECENT);
  return records.filter((rec) => {
    if (!rec?.id || !rec.title || items[rec.id]) return false;
    if (rec.start_date) return rec.start_date >= today && rec.start_date <= last;
    const day = dayOf(rec);
    return !!day && day >= oldest && day <= last;
  });
}

/** What the model reads about one notice: facts only, short. */
export function describe(rec, i) {
  return Object.fromEntries(Object.entries({
    i, city: rec.city, kind: rec.kind, title: rec.title,
    date: rec.start_date || (rec.published ? `published ${rec.published.slice(0, 10)}` : undefined),
    time: rec.start_time && rec.end_time ? `${rec.start_time}–${rec.end_time}` : rec.start_time,
    place: [rec.place, rec.postcode].filter(Boolean).join(", ") || undefined,
    route: rec.route,
  }).filter(([, v]) => v !== undefined && v !== ""));
}

/** JSON out of a model's answer, or null. */
function jsonOf(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/** The screening answers as {index: verdict}; anything odd is dropped and asked again next night. */
export function parseScreen(text, count) {
  const out = {};
  for (const a of Array.isArray(jsonOf(text)?.answers) ? jsonOf(text).answers : []) {
    if (Number.isInteger(a?.i) && a.i >= 0 && a.i < count && ["yes", "no", "unsure"].includes(a.f)) out[a.i] = a.f;
  }
  return out;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const clip = (s, n) => (typeof s === "string" ? s.trim().slice(0, n) : "");

/** The detail answer, checked: dates and times in shape, all three lines present. Null when it is unusable. */
export function parseDetail(text) {
  const a = jsonOf(text);
  if (!a || !["yes", "no", "unsure"].includes(a.relevant)) return null;
  const line = { de: clip(a.line?.de, 160), en: clip(a.line?.en, 160), zh: clip(a.line?.zh, 160) };
  if (a.relevant !== "no" && !(line.de && line.en && line.zh)) return null;
  return {
    relevant: a.relevant,
    ...(DAY.test(a.day) ? { day: a.day } : {}),
    ...(DAY.test(a.until) && (!DAY.test(a.day) || a.until > a.day) ? { until: a.until } : {}),
    ...(TIME.test(a.from) ? { from: a.from } : {}),
    ...(TIME.test(a.to) ? { to: a.to } : {}),
    ...(clip(a.where, 120) ? { where: clip(a.where, 120) } : {}),
    line,
  };
}

/** A page of its own for this record (a press release), not a list shared by many records. */
export function ownPage(rec, records) {
  if (!rec.source_url) return false;
  return records.filter((r) => r.source_url === rec.source_url).length === 1;
}

/** The text of an official page; empty when it can't be read (the model then works from the facts). */
export async function readPage(url, fetchFn = globalThis.fetch) {
  try {
    const res = await fetchFn(url, { headers: { "user-agent": "little-outings city alerts (+https://outings.allo.land)" }, redirect: "follow" });
    if (!res.ok) return "";
    const text = pageText(await res.text());
    return text.length > PAGE_MAX ? text.slice(0, PAGE_MAX) : text;
  } catch {
    return "";
  }
}

/** Screens `records` in batches; returns {id: verdict} and the first error, if any stopped a batch. */
export async function screen(records, llm, model, ask = complete) {
  const verdicts = {};
  let error = null;
  const batches = [];
  for (let at = 0; at < records.length; at += BATCH) batches.push(records.slice(at, at + BATCH));
  await eachLimit(batches, AT_ONCE, async (batch) => {
    let text;
    try {
      text = await ask(llm, model, { system: SCREEN, text: JSON.stringify(batch.map(describe)), maxTokens: 3000, json: true });
    } catch (e) {
      error ??= e;
      return false;
    }
    const answers = parseScreen(text, batch.length);
    batch.forEach((rec, i) => { if (answers[i]) verdicts[rec.id] = answers[i]; });
  });
  return { verdicts, error };
}

/** Reads the page (when the record has its own) and asks for the day, times and lines. Null when it failed. */
export async function detail(rec, records, llm, model, { ask = complete, fetchFn = globalThis.fetch } = {}) {
  const page = ownPage(rec, records) ? await readPage(rec.source_url, fetchFn) : "";
  const { i: _, ...facts } = describe(rec, 0);
  const text = JSON.stringify({ notice: facts }) + (page ? `\n\nOfficial page:\n${page}` : "");
  try {
    return parseDetail(await ask(llm, model, { system: DETAIL, text, maxTokens: 1200, json: true }));
  } catch {
    return null;
  }
}

/** One stored item: the facts, and the AI's verdict and lines. Your decision lives in alert-decisions.json. */
export function itemOf(rec, verdict, found, now) {
  return {
    id: rec.id,
    city: rec.city,
    kind: rec.kind,
    title: rec.title,
    url: rec.source_url,
    source_id: rec._source?.source_id || null,
    day: found?.day || rec.start_date || null,
    ...(found?.until ? { until: found.until } : {}),
    ...((found?.from || rec.start_time) && (found?.from || rec.start_time) !== "00:00" ? { from: found?.from || rec.start_time } : {}),
    ...((found?.to || rec.end_time) && (found?.to || rec.end_time) !== "23:59" ? { to: found?.to || rec.end_time } : {}),
    ...(found?.where || rec.place ? { where: found?.where || rec.place } : {}),
    verdict: found ? found.relevant : verdict,
    ...(found?.line ? { line: found.line } : {}),
    checked_at: now,
  };
}

/** Items that are over (a day past their last day), or never got a day and are older than RECENT days. */
export function prune(items, today) {
  const keepFrom = addDays(today, -1);
  const oldest = addDays(today, -RECENT);
  return Object.fromEntries(Object.entries(items).filter(([, it]) =>
    it.day ? (it.until || it.day) >= keepFrom : (it.checked_at || "").slice(0, 10) >= oldest));
}

/** After the rules change, items you decided on stay; open ones are asked again. */
export function keepDecided(items, decisions) {
  return Object.fromEntries(Object.entries(items).filter(([id]) => decisions?.alerts?.[id]));
}

export function parseRecords(text) {
  return text.split("\n").filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

async function readExport(source) {
  if (!/^https?:/.test(source)) return existsSync(source) ? readFileSync(source, "utf8") : null;
  const res = await fetch(source, { headers: { "user-agent": "little-outings city alerts (+https://outings.allo.land)" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${source}`);
  return res.text();
}

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

/** data/alerts.json: what the site shows. Written only when it changed. */
function publish(store, decisions, today) {
  const after = JSON.stringify({ alerts: confirmedAlerts(store, decisions, today) }, null, 2) + "\n";
  const before = existsSync(PUBLISHED) ? readFileSync(PUBLISHED, "utf8") : "";
  if (after !== before) writeFileSync(PUBLISHED, after);
  return JSON.parse(after).alerts.length;
}

async function main() {
  const today = process.env.ALERTS_TODAY || iso(new Date());
  const store = readJson(`${DIR}/alerts.json`, { schema_version: 1, items: {} });
  const decisions = readJson(`${DIR}/alert-decisions.json`, null);
  if (store.prompt_version !== PROMPT_VERSION) {
    store.items = keepDecided(store.items, decisions);
    store.prompt_version = PROMPT_VERSION;
  }
  store.items = prune(store.items, today);

  let text;
  try { text = await readExport(EXPORT); } catch (e) {
    console.log(`::warning title=City alerts::could not read the export: ${e.message}`);
  }
  const records = text ? parseRecords(text) : [];
  const todo = toCheck(records, store.items, today).slice(0, LIMIT);
  const llm = pickLlm(process.env);
  const model = process.env.ALERTS_MODEL;
  let note;
  if (!text) note = "no city-anomalies export yet";
  else if (!todo.length) note = `${records.length} records, nothing new`;
  else if (!llm) note = `${todo.length} new alerts not checked (no GEMINI_API_KEY or ANTHROPIC_API_KEY)`;
  else {
    const now = new Date().toISOString();
    const { verdicts, error } = await screen(todo, llm, model);
    if (error) console.log(`::warning title=City alerts::screening stopped early: ${error.message}`);
    const kept = todo.filter((rec) => verdicts[rec.id] && verdicts[rec.id] !== "no");
    const found = {};
    await eachLimit(kept, AT_ONCE, async (rec) => { found[rec.id] = await detail(rec, records, llm, model); });
    let flagged = 0;
    for (const rec of todo) {
      if (!verdicts[rec.id]) continue; // not answered: asked again next night
      if (verdicts[rec.id] !== "no" && !found[rec.id]) continue; // the detail step failed: asked again next night
      const item = itemOf(rec, verdicts[rec.id], found[rec.id], now);
      store.items[rec.id] = item;
      if (item.verdict !== "no") flagged++;
    }
    note = `checked ${Object.keys(verdicts).length} of ${todo.length} new alerts; ${flagged} for the admin to confirm`;
  }
  store.updated_at = new Date().toISOString();
  writeFileSync(`${DIR}/alerts.json`, JSON.stringify(store));
  const shown = publish(store, decisions, today);
  console.log(`alerts: ${note}; ${shown} confirmed alerts on the site`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
