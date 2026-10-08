// Build-time data access for pages. Everything here runs once per build, never in the browser.
import { getCollection } from "astro:content";
import { normalizeEvent, normalizePlace, shiftDays, type Town } from "./merge.ts";
import { tasksOf } from "./gaps.ts";
import type { Event, Place } from "./types.ts";

/** The build date in Germany. The site is rebuilt every night, so "upcoming" stays true. */
export const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());

// The fictional demo events are dated around this day; the demo shifts them so they never expire.
const DEMO_ANCHOR = "2026-10-08";
const demoShift = process.env.DEMO ? Math.round((Date.parse(TODAY) - Date.parse(DEMO_ANCHOR)) / 864e5) : 0;

let cache: Promise<Data> | undefined;
export interface Data {
  region: { name: any; center: string; towns: (Town & { zh?: string; en?: string })[] };
  places: Place[];
  /** Upcoming events only (end ≥ today), sorted by start. */
  events: Event[];
  placeById: Map<string, Place>;
  eventById: Map<string, Event>;
}

export const getData = () => (cache ??= load());

async function load(): Promise<Data> {
  const [regions, rawPlaces, rawEvents, imported, overrides, answers] = await Promise.all([
    getCollection("regions"), getCollection("places"), getCollection("events"),
    getCollection("imported"), getCollection("overrides"), getCollection("answers"),
  ]);
  const region = regions[0]?.data ?? { name: "", center: "", towns: [] };
  const towns = regions.flatMap((r) => r.data.towns);
  const slug = (id: string) => id.split("/").pop()!;
  const answer = new Map(answers.map((a) => [slug(a.id), a.data]));
  const override = new Map(overrides.map((o) => [slug(o.id), o.data]));

  const places = rawPlaces.map((p) => normalizePlace(slug(p.id), p.data, answer.get(slug(p.id)), towns));
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
    if (ev.end >= TODAY) events.push(ev);
  }
  events.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  return { region, places, events, placeById, eventById: new Map(events.map((e) => [e.id, e])) };
}

export async function getTasks() {
  const { events, places } = await getData();
  return tasksOf(events, places, TODAY);
}

export const eventsAt = (events: Event[], placeId: string) => events.filter((e) => e.place === placeId);
