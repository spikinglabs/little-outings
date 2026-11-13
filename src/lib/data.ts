// Build-time data access for pages. Everything here runs once per build, never in the browser.
import { getCollection } from "astro:content";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { current, type Alert } from "./alerts.ts";
import type { Recall } from "./recalls.ts";
import { tagSharedNames } from "./credit.ts";
import { applyEventTally, applyTally, applyTranslations, canonicalTown, normalizeEvent, normalizePlace, resolveGeo, shiftDays, townsFromPlaces, type Town } from "./merge.ts";
import { fixtureEvent, loadSeasons, seasonsOf, type SeasonData } from "./seasons.ts";
import { tasksOf } from "./gaps.ts";
import { whereGuesser } from "./where-guess.ts";
import type { Event, Place, Tally } from "./types.ts";
import { pack, type Packed } from "./weather.ts";
import { withTimes } from "./time-text.ts";

/** The build date in Germany. The site is rebuilt every night, so "upcoming" stays true. */
export const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());

// The fictional demo events are dated around this day; the demo shifts them so they never expire.
const ROOT = process.env.DEMO ? "examples" : "content";
const DEMO_ANCHOR = "2026-10-08";
const demoShift = process.env.DEMO ? Math.round((Date.parse(TODAY) - Date.parse(DEMO_ANCHOR)) / 864e5) : 0;

let cache: Promise<Data> | undefined;
export interface Data {
  region: { name: any; center: string; towns: (Town & { zh?: string; en?: string; state?: string })[] };
  places: Place[];
  /** Upcoming events only (end ≥ today), sorted by start. */
  events: Event[];
  placeById: Map<string, Place>;
  eventById: Map<string, Event>;
  /**
   * Events that had a page and no longer do: past ones (from data/past-events/, scripts/archive-events.mjs,
   * and the hand-written and fixture events that ended) and imported ones that dropped out. Their old
   * addresses answer with a "this event is over" page (src/lib/gone.ts).
   */
  gone: Event[];
  /** Seasons and their fixtures, past ones included (landing pages show last season off season). */
  seasons: SeasonData;
}

export const getData = () => (cache ??= load());

async function load(): Promise<Data> {
  const [regions, rawPlaces, rawEvents, imported, overrides, answers] = await Promise.all([
    getCollection("regions"), getCollection("places"), getCollection("events"),
    getCollection("imported"), getCollection("overrides"), getCollection("answers"),
  ]);
  const home = regions[0]?.data ?? { name: "", center: "", towns: [] };
  const regionTowns = regions.flatMap((r) => r.data.towns.map((t) => ({ ...t, state: t.state ?? r.data.state })));
  const slug = (id: string) => id.split("/").pop()!;
  const answer = new Map(answers.map((a) => [slug(a.id), a.data]));
  const override = new Map(overrides.map((o) => [slug(o.id), o.data]));

  const tallies = inboxTallies();
  const tr = { en: translations("en"), zh: translations("zh") };
  const trTime = { en: translations("time-en"), zh: translations("time-zh") };
  // Events get their title and their time line translated.
  const local = (ev: Event) => withTimes(applyTranslations(ev, tr), trTime);
  // Places parents suggested (inbox-<n>) name their town as typed; "Cologne" is the site's Köln.
  const raw = rawPlaces.map((p) => {
    const id = slug(p.id);
    if (!id.startsWith("inbox-")) return { id, data: p.data };
    return { id, data: { ...p.data, address: { ...p.data.address, town: canonicalTown(p.data.address.town, regionTowns) } } };
  });
  const places = raw.map((p) => applyTranslations(applyTally(normalizePlace(p.id, p.data, answer.get(p.id), regionTowns), tallies[p.id]), tr));
  // A town only a parent's place is in (Merzenich) joins the town picker.
  const towns = [...regionTowns, ...townsFromPlaces(places.filter((p) => p.id.startsWith("inbox-")), regionTowns)];
  const region = { ...home, towns };
  const placeById = new Map(places.map((p) => [p.id, p]));

  const seen = new Set<string>();
  const events: Event[] = [];
  const gone = new Map<string, Event>();
  for (const e of [...rawEvents, ...imported]) {
    const id = slug(e.id);
    if (seen.has(id) || placeById.has(id)) throw new Error(`duplicate id "${id}"; ids must be unique across places and events`);
    seen.add(id);
    const ev = normalizeEvent(id, e.data, { answer: answer.get(id), override: override.get(id) }, placeById, towns);
    if (!ev) continue;
    if (demoShift) Object.assign(ev, { start: shiftDays(ev.start, demoShift), end: shiftDays(ev.end, demoShift) });
    if (ev.end >= TODAY) events.push(applyEventTally(local(ev), tallies[id], placeById));
    else gone.set(id, local(ev));
  }
  // Fixtures (Christmas markets, fairs) are events too; one without a pin sits at its town's centre.
  const seasons = loadSeasons("content/seasons.yaml", ROOT);
  for (const file of seasons.fixtures) for (const f of file.items) {
    const ev = fixtureEvent(file, f, seasons.seasons.find((s) => s.id === file.season)?.fixture_tags);
    if (seen.has(ev.id)) throw new Error(`duplicate id "${ev.id}"`);
    seen.add(ev.id);
    if (ev.end < TODAY) {
      gone.set(ev.id, local({ ...ev, geo: resolveGeo(f.geo, file.town, towns) }));
      continue;
    }
    events.push(applyEventTally(local({ ...ev, geo: resolveGeo(f.geo, file.town, towns) }), tallies[ev.id], placeById));
  }
  for (const p of places) {
    const of = seasons.seasons.filter((s) => s.kinds?.includes(p.kind)).map((s) => s.id);
    if (of.length) p.seasons = of;
  }
  // Imported events that had a page once and are no longer imported: past, or dropped by the source.
  if (!demoShift) for (const a of pastEvents()) {
    if (seen.has(a.id) || gone.has(a.id)) continue;
    const ev = normalizeEvent(a.id, { ...a, origin: "cityklub", trust: { level: "official", source: a.attribution } }, {}, placeById, towns);
    if (ev) gone.set(a.id, local(ev));
  }
  for (const e of [...events, ...gone.values()]) {
    const found = seasonsOf(typeof e.title === "string" ? e.title : e.title.de, seasons.seasons);
    const all = [...new Set([...(e.seasons ?? []), ...found])];
    if (all.length) e.seasons = all;
  }
  events.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  // Events without an address get a few spots to pick from in "Still missing".
  const guessWhere = whereGuesser(events, places);
  for (const e of events) {
    const guesses = guessWhere(e);
    if (guesses.length) e.guesses = guesses;
  }
  // Same nickname, different families: tell them apart with a short tag.
  tagSharedNames([...places, ...events, ...places.flatMap((p) => p.tips ?? [])]);
  return { region, places, events, placeById, eventById: new Map(events.map((e) => [e.id, e])), gone: [...gone.values()], seasons };
}

/** data/past-events/<YYYY-MM>.jsonl, written by scripts/archive-events.mjs. */
function pastEvents(dir = "data/past-events"): any[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) => readFileSync(`${dir}/${f}`, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)));
}

/** Parents' votes, visits and approved tips, counted by scripts/tally-inbox.mjs before the build. */
function inboxTallies(): Record<string, Tally> {
  try { return JSON.parse(readFileSync("data/inbox-tallies.json", "utf8")); } catch { return {}; }
}

/** Machine translations by German text, kept up to date by scripts/translate.mjs. */
function translations(lang: string): Record<string, string> {
  try { return JSON.parse(readFileSync(`data/translations/${lang}.json`, "utf8")); } catch { return {}; }
}

let weather: Packed | undefined | null = null;
/** The next days' weather per town (data/weather.json, scripts/fetch-weather.mjs), from today; undefined without a forecast. */
export async function getWeather(): Promise<Packed | undefined> {
  if (weather !== null) return weather;
  let file;
  try { file = JSON.parse(readFileSync("data/weather.json", "utf8")); } catch { /* no forecast this build */ }
  return (weather = pack(file, (await getData()).region.towns, TODAY));
}

/** Confirmed city alerts still on or coming soon (lib/alerts.ts); none without the file. */
export function getAlerts(): Alert[] {
  try { return current(JSON.parse(readFileSync("data/alerts.json", "utf8")).alerts ?? [], TODAY); } catch { return []; }
}

/** Recent recalls of children's products in Germany (lib/recalls.ts), newest first; none without the file. */
export function getRecalls(): Recall[] {
  try { return JSON.parse(readFileSync("data/recalls.json", "utf8")).recalls ?? []; } catch { return []; }
}

export async function getTasks() {
  const { events, places } = await getData();
  return tasksOf(events, places, TODAY);
}

export const eventsAt = (events: Event[], placeId: string) => events.filter((e) => e.place === placeId);
