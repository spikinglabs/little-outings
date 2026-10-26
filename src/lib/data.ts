// Build-time data access for pages. Everything here runs once per build, never in the browser.
import { getCollection } from "astro:content";
import { readFileSync } from "node:fs";
import { applyEventTally, applyTally, applyTranslations, canonicalTown, normalizeEvent, normalizePlace, resolveGeo, shiftDays, townsFromPlaces, type Town } from "./merge.ts";
import { fixtureEvent, loadSeasons, seasonsOf, type SeasonData } from "./seasons.ts";
import { tasksOf } from "./gaps.ts";
import type { Event, Place, Tally } from "./types.ts";

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
  for (const e of [...rawEvents, ...imported]) {
    const id = slug(e.id);
    if (seen.has(id) || placeById.has(id)) throw new Error(`duplicate id "${id}"; ids must be unique across places and events`);
    seen.add(id);
    const ev = normalizeEvent(id, e.data, { answer: answer.get(id), override: override.get(id) }, placeById, towns);
    if (!ev) continue;
    if (demoShift) Object.assign(ev, { start: shiftDays(ev.start, demoShift), end: shiftDays(ev.end, demoShift) });
    if (ev.end >= TODAY) events.push(applyEventTally(applyTranslations(ev, tr), tallies[id]));
  }
  // Fixtures (Christmas markets, fairs) are events too; one without a pin sits at its town's centre.
  const seasons = loadSeasons("content/seasons.yaml", ROOT);
  for (const file of seasons.fixtures) for (const f of file.items) {
    const ev = fixtureEvent(file, f);
    if (ev.end < TODAY) continue;
    if (seen.has(ev.id)) throw new Error(`duplicate id "${ev.id}"`);
    seen.add(ev.id);
    events.push(applyEventTally(applyTranslations({ ...ev, geo: resolveGeo(f.geo, file.town, towns) }, tr), tallies[ev.id]));
  }
  for (const e of events) {
    const found = seasonsOf(typeof e.title === "string" ? e.title : e.title.de, seasons.seasons);
    const all = [...new Set([...(e.seasons ?? []), ...found])];
    if (all.length) e.seasons = all;
  }
  events.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  return { region, places, events, placeById, eventById: new Map(events.map((e) => [e.id, e])), seasons };
}

/** Parents' votes, visits and approved tips, counted by scripts/tally-inbox.mjs before the build. */
function inboxTallies(): Record<string, Tally> {
  try { return JSON.parse(readFileSync("data/inbox-tallies.json", "utf8")); } catch { return {}; }
}

/** Machine translations by German text, kept up to date by scripts/translate.mjs. */
function translations(lang: string): Record<string, string> {
  try { return JSON.parse(readFileSync(`data/translations/${lang}.json`, "utf8")); } catch { return {}; }
}

export async function getTasks() {
  const { events, places } = await getData();
  return tasksOf(events, places, TODAY);
}

export const eventsAt = (events: Event[], placeId: string) => events.filter((e) => e.place === placeId);
