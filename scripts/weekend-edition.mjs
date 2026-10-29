// The weekly "This weekend" edition (src/lib/weekend.ts), run every night in the Translate workflow
// after the events are sorted. What it does depends on the day in Germany:
//   Thursday              drafts the coming weekend's picks per town into DRAFT_FILE, which the workflow
//                         uploads to the bucket; the admin's "Weekend" panel shows it and can swap picks
//   Friday                publishes: takes the draft (with your swaps), writes the lines for swapped-in
//                         picks, adds the forecast and commits data/weekend/<town>/<saturday>.json,
//                         which the 02:15 deploy turns into /<lang>/wochenende/<town>/
//   Saturday, Sunday      publishes only if Friday's run didn't
//   Monday to Wednesday   nothing
// WEEKEND_MODE=draft|publish runs that step on any day (for a first edition or a test).
// Without an AI key the plain score picks and the titles stand in for the AI's lines.
//
//   GEMINI_API_KEY=… npm run weekend        (or ANTHROPIC_API_KEY; WEEKEND_MODEL picks the model)
//   WEEKEND_TODAY=2026-10-29 WEEKEND_MODE=draft npm run weekend
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { fromExport } from "./import-cityklub.mjs";
import { download } from "./import-places.mjs";
import { complete, pickLlm } from "../src/lib/llm.ts";
import {
  LONG_RUN, MIN_EVENTS, PICKS, PICK_PROMPT, PLACE_PROMPT, RECENT_EVENTS, RECENT_PLACES, SHORTLIST, WEEKEND_TOWNS,
  addDays, byWhen, describe, madeForKids, dow, indoorOf, isDry, isRainy, isoWeek, parsePicks, pickMix, placeCandidates, recentKey,
  scoreEvent, townSlug, weekendOf,
} from "../src/lib/weekend.ts";

const DRAFT = process.env.DRAFT_FILE || ".cache/outings/weekend.json";
const OUT = process.env.WEEKEND_DIR || "data/weekend";
const PUBLISHED = process.env.OUTINGS_FILE || "data/outings.jsonl";
const PLACES = process.env.OSM_FILE || "data/places-osm.jsonl";
const ROOT = process.env.CONTENT_DIR || "content";

const jsonl = (path) => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const readJson = (path, fallback) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; } };

/** Earlier editions of a town, newest first. */
export function pastEditions(dir, slug, before) {
  const d = join(dir, slug);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f) && f.slice(0, 10) < before).sort().reverse()
    .map((f) => readJson(join(d, f), null)).filter(Boolean);
}

/**
 * The weekend's events in a town as picks, one per title and venue (an event on both days is one pick),
 * with events running longer than a week set apart for the "Still on" line.
 */
export function weekendEvents(rows, { town, towns, sat }) {
  const fri = addDays(sat, -1), sun = addDays(sat, 1);
  const byKey = new Map(), still = [];
  for (const row of rows) {
    if (row.sold_out === true || row.expired === true) continue;
    const ev = fromExport(row, { towns, today: fri, until: sun });
    if (!ev || ev.data.town !== town) continue;
    const e = ev.data, end = e.end ?? e.start;
    if (end < fri) continue;
    const span = (Date.parse(end) - Date.parse(e.start)) / 864e5;
    const venue = e.venue, tags = e.tags ?? [];
    if (span > LONG_RUN) {
      still.push({ id: ev.id, type: "event", title: e.title, venue, end, days: [], free: e.price?.free || undefined, tags, source: `${row.source_id ?? ""} ${row.source_name ?? ""}` });
      continue;
    }
    const hour = Number((e.time ?? "").match(/\d{1,2}/)?.[0] ?? 12);
    const days = [fri, sat, sun].filter((d) => d >= e.start && d <= end && (d !== fri || hour >= 14));
    if (!days.length) continue;
    const key = `${e.title.toLowerCase()}|${(venue ?? "").toLowerCase()}`;
    const had = byKey.get(key);
    if (had) { had.days = [...new Set([...had.days, ...days])].sort(); continue; }
    byKey.set(key, {
      id: ev.id, type: "event", title: e.title, venue, district: row.location?.district, days, time: e.time,
      free: e.price?.free || undefined, price: e.price?.text, book: row.registration_required === true || undefined,
      indoor: indoorOf(e.title, venue, tags), tags, source: `${row.source_id ?? ""} ${row.source_name ?? ""}`,
    });
  }
  return { events: [...byKey.values()], still };
}

/** Saturday and Sunday from Open-Meteo (free, no key; CC BY 4.0). Undefined when it can't be reached. */
export async function forecast(lat, lon, sat, fetchFn = fetch) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,precipitation_probability_max&timezone=Europe%2FBerlin&start_date=${sat}&end_date=${addDays(sat, 1)}`;
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return undefined;
    const d = (await res.json()).daily;
    if (!d?.time?.length) return undefined;
    return d.time.map((day, i) => ({ day, code: d.weather_code[i] ?? 0, max: d.temperature_2m_max[i] ?? 0, rain: d.precipitation_probability_max[i] ?? 0 }));
  } catch { return undefined; }
}

/** The school holidays the weekend falls in, if any, and whether it ends that weekend. */
export function holidayOn(periods, sat) {
  const sun = addDays(sat, 1);
  const p = (periods ?? []).find((h) => h.start <= sun && h.end >= sat);
  return p ? { name: p.name, last: p.end === sat || p.end === sun } : undefined;
}

async function ask(llm, system, text) {
  if (!llm) return null;
  try {
    return await complete(llm, process.env.WEEKEND_MODEL, { system, text, maxTokens: 4000, json: true });
  } catch (e) {
    console.log(`::warning title=Weekend::the AI didn't answer (${e.message.slice(0, 120)}); the plain score picks`);
    return null;
  }
}

/** Lines for picks that have none yet (swapped in by hand, or places), or only your German one, in one call. */
async function addLines(llm, picks) {
  const need = picks.filter((p) => !p.label || !p.why?.en || !p.why?.zh);
  if (!need.length) return;
  const answer = await ask(llm, PLACE_PROMPT, need.map((p, i) => describe(p, i) + (p.why?.de ? ` | say: ${p.why.de}` : "")).join("\n"));
  for (const a of answer ? parsePicks(answer, need.length, "items") : []) {
    const p = need[a.i];
    if (a.label) p.label = a.label;
    // Your own German line from the admin stays; the AI only translates it.
    if (a.why) p.why = p.why?.de ? { ...a.why, de: p.why.de } : a.why;
  }
}

/** One town's draft: the picks, the alternates the admin can swap in, and "Still on". */
export async function draftTown({ town, rows, places, towns, sat, weather, holiday, past, hidden, llm }) {
  const rain = isRainy(weather?.[0]) || isRainy(weather?.[1]);
  const dry = !rain && isDry(weather?.[0]) && isDry(weather?.[1]);
  const recent = new Set(past.slice(0, RECENT_EVENTS).flatMap((e) => e.picks.map(recentKey)));
  const recentPlaces = new Set(past.slice(0, RECENT_PLACES).flatMap((e) => e.picks.filter((p) => p.type === "place").map((p) => p.id)));
  const { events, still } = weekendEvents(rows, { town, towns, sat });
  for (const e of events) e.score = scoreEvent(e, { source: e.source, rain, dry, recent });
  const shortlist = events.filter((e) => e.score >= 1).sort((a, b) => b.score - a.score).slice(0, SHORTLIST);
  const sun = addDays(sat, 1);

  let picks = pickMix(shortlist, { rain, sat, sun });
  let by = "score";
  const header = [
    `Town: ${town}. Weekend: Saturday ${sat}, Sunday ${sun}.`,
    weather ? `Weather: ${weather.map((w) => `${w.day} max ${Math.round(w.max)}°C, rain chance ${w.rain}%`).join("; ")}.` : "Weather: unknown.",
    holiday ? `School holidays (${holiday.name})${holiday.last ? ", ending this weekend" : ""}.` : "",
  ].filter(Boolean).join("\n");
  const want = Math.min(PICKS, shortlist.length);
  const answer = want ? await ask(llm, PICK_PROMPT.replace("{n}", String(want)), `${header}\n\n${shortlist.map(describe).join("\n")}`) : null;
  const chosen = answer ? parsePicks(answer, shortlist.length) : [];
  if (want && chosen.length >= Math.min(3, want)) {
    picks = chosen.slice(0, PICKS).map((c) => ({ ...shortlist[c.i], label: c.label, why: c.why }));
    // Fill up from the plain score if the AI gave fewer than asked.
    for (const p of pickMix(shortlist, { rain, sat, sun })) if (picks.length < want && !picks.includes(p)) picks.push(p);
    by = "ai";
  }

  // One place that is always a good idea; more when the town has few good events this weekend.
  const month = Number(sat.slice(5, 7)) - 1;
  const placeList = placeCandidates(places, { town, month, rain, recent: recentPlaces, hidden });
  // The AI's picks are kept; from the plain score only clear family events (score 2 and up).
  const kept = by === "ai" ? picks : picks.filter((p) => (p.score ?? 0) >= 2);
  // Places of different kinds, so a thin weekend isn't filled with five farm shops.
  const kinds = new Set();
  const placePicks = placeList.filter((p) => !kinds.has(p.kind) && kinds.add(p.kind)).slice(0, Math.max(1, PICKS + 1 - kept.length));
  picks = [...kept, ...placePicks];
  await addLines(llm, picks);
  for (const p of picks) delete p.source;

  const alternates = [...shortlist.filter((e) => !picks.some((p) => p.id === e.id)), ...placeList.filter((p) => !picks.some((q) => q.id === p.id)).slice(0, 8)]
    .map(({ source, ...p }) => p);
  // Long-running things worth a mention: clearly for families, ending soonest first.
  const stillOn = still.map((x) => ({ ...x, score: scoreEvent(x, { source: x.source }) })).filter((x) => x.score >= 2 && madeForKids(x.title))
    .sort((a, b) => b.score - a.score || a.end.localeCompare(b.end)).slice(0, 3)
    .map(({ id, title, venue, end }) => ({ id, title, venue, end }));
  return { picks: picks.sort(byWhen), alternates, still: stillOn, weather, by };
}

/** The town's record from the region files: coordinates and state (for school holidays). */
function regionTowns() {
  const dir = join(ROOT, "regions");
  return readdirSync(dir).filter((f) => f.endsWith(".yaml")).flatMap((f) => {
    const r = load(readFileSync(join(dir, f), "utf8"));
    return (r.towns ?? []).map((t) => ({ ...t, state: t.state ?? r.state }));
  });
}

export async function draft({ sat, today, llm, only = WEEKEND_TOWNS }) {
  const towns = regionTowns();
  const rows = jsonl(PUBLISHED);
  // The live places file (every town), else the snapshot in the repository, which has the first towns only.
  const places = (process.env.PLACES_EXPORT && (await download(process.env.PLACES_EXPORT))) || jsonl(PLACES);
  const holidays = readJson("data/school-holidays.json", { states: {} }).states ?? {};
  const hiddenFile = join(ROOT, "hidden-places.yaml");
  const hidden = new Set(existsSync(hiddenFile) ? load(readFileSync(hiddenFile, "utf8")) || [] : []);
  const out = { weekend: sat, drafted_at: new Date().toISOString(), towns: {} };
  for (const town of only) {
    const rec = towns.find((t) => t.name === town);
    if (!rec) { console.log(`::warning title=Weekend::${town} is not in content/regions`); continue; }
    const weather = await forecast(rec.lat, rec.lon, sat);
    const past = pastEditions(OUT, townSlug(town), sat);
    const d = await draftTown({ town, rows, places, towns, sat, weather, holiday: holidayOn(holidays[rec.state], sat), past, hidden, llm });
    out.towns[town] = d;
    console.log(`weekend: ${town} ${sat}: ${d.picks.length} picks (${d.by}), ${d.alternates.length} alternates${weather ? "" : ", no forecast"}`);
  }
  void today;
  return out;
}

/** Friday: the draft (with any swaps from the admin) becomes the published edition. */
export async function publish({ sat, llm, draftDoc }) {
  const towns = regionTowns();
  const holidays = readJson("data/school-holidays.json", { states: {} }).states ?? {};
  const doc = draftDoc?.weekend === sat ? draftDoc : await draft({ sat, llm });
  // A town the Thursday draft found too few events for (its events were published after the
  // draft, say a city whose sources were just included) is drafted again from today's events.
  const thin = WEEKEND_TOWNS.filter((t) => (doc.towns[t]?.picks ?? []).filter((p) => p.type === "event").length < MIN_EVENTS);
  if (doc === draftDoc && thin.length) {
    const again = await draft({ sat, llm, only: thin });
    doc.towns = { ...doc.towns, ...again.towns };
  }
  const written = [];
  for (const [town, d] of Object.entries(doc.towns)) {
    const rec = towns.find((t) => t.name === town);
    if (!rec || !d.picks?.length) continue;
    // A town with too few family events this weekend (say its collection stopped) skips a week
    // rather than going out as a list of farm shops; the page then points to next Friday.
    const events = d.picks.filter((p) => p.type === "event").length;
    if (events < MIN_EVENTS) { console.log(`::notice title=Weekend::${town}: only ${events} events, no edition this week`); continue; }
    await addLines(llm, d.picks);
    const weather = (await forecast(rec.lat, rec.lon, sat)) ?? d.weather;
    const slug = townSlug(town);
    const edition = {
      town, slug, weekend: sat, week: isoWeek(sat), published_at: new Date().toISOString(),
      by: doc.edited_at ? "admin" : d.by,
      ...(weather && { weather }),
      ...(holidayOn(holidays[rec.state], sat) && { holiday: holidayOn(holidays[rec.state], sat) }),
      picks: d.picks.map(({ score, ...p }) => p),
      ...(d.still?.length && { still: d.still }),
    };
    mkdirSync(join(OUT, slug), { recursive: true });
    const file = join(OUT, slug, `${sat}.json`);
    writeFileSync(file, JSON.stringify(edition, null, 2) + "\n");
    written.push(file);
  }
  return written;
}

async function main() {
  const today = process.env.WEEKEND_TODAY || new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  const sat = weekendOf(today);
  const day = dow(today);
  const mode = process.env.WEEKEND_MODE || (day === 4 ? "draft" : day === 5 ? "publish" : day === 6 || day === 0 ? "catch-up" : "rest");
  const llm = pickLlm(process.env);
  if (!llm) console.log("weekend: no AI key; the plain score picks and titles stand in for the AI's lines");
  const existing = readJson(DRAFT, null);

  if (mode === "rest") return console.log(`weekend: nothing to do on ${today} (drafts Thursday, publishes Friday)`);
  if (mode === "draft") {
    // Keep a draft for the same weekend that someone already edited in the admin.
    if (existing?.weekend === sat && existing.edited_at && !process.env.FORCE) return console.log(`weekend: the draft for ${sat} was edited in the admin; kept`);
    mkdirSync(join(DRAFT, ".."), { recursive: true });
    writeFileSync(DRAFT, JSON.stringify(await draft({ sat, today, llm }), null, 2) + "\n");
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "drafted=1\n");
    return console.log(`weekend: drafted ${sat} → ${DRAFT}`);
  }
  if (mode === "catch-up" && WEEKEND_TOWNS.every((t) => existsSync(join(OUT, townSlug(t), `${sat}.json`)))) {
    return console.log(`weekend: ${sat} is already published`);
  }
  const files = await publish({ sat, llm, draftDoc: existing });
  console.log(`weekend: published ${files.length} edition(s) for ${sat}: ${files.join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
