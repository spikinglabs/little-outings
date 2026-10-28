// City pages (/<lang>/stadt/<town>/): one page per town that answers what parents type into a search box,
// "科隆带娃去哪儿", "Köln mit Kindern", "Cologne with kids". Everything on them comes from the same
// data as Discover, picked here so the page and its tests agree on what counts.
import type { Event, Place } from "./types.ts";
import { addDays, townSlug, weekendOf } from "./weekend.ts";
import { lastDay } from "./horizon.ts";
import { indoorGuess, PLACE_KINDS } from "./search.ts";
import { MORE_TOWN_NAMES } from "./town-names.ts";

/** A town needs this many events and places together before it gets a page; fewer would be a thin page. */
export const CITY_MIN = 12;
/** Cards per kind of place, and upcoming events, on a city page. */
export const PER_KIND = 4;
export const SOON = 6;
/** Other cities linked at the foot of a city page. */
export const OTHERS = 16;

export const cityPath = (lang: string, slug?: string) => `/${lang}/stadt/${slug ? `${slug}/` : ""}`;

/** How much a place page has to show: parents' visits and tips first, then a rating, then known facilities. */
export function placeScore(p: Place): number {
  const known = Object.values(p.facilities).filter((f) => f.status !== "unknown").length;
  return (p.visits?.count ?? 0) * 10 + (p.tips?.length ?? 0) * 5 + (p.rating ? Math.min(p.rating.reviews, 200) / 20 : 0)
    + known + (p.website ? 2 : 0) + (p.hours ? 2 : 0) + (p.note ? 2 : 0);
}

const best = (ps: Place[]) => [...ps].sort((a, b) => placeScore(b) - placeScore(a) || a.name.localeCompare(b.name));
/** Events with a known place, starting within Discover's two weeks from `today`, soonest first. */
const located = (es: Event[], today: string) => { const last = lastDay(today); return es.filter((e) => e.geo.precision !== "unknown" && e.start <= last); };

export interface CityFacts {
  events: Event[];
  places: Place[];
  soon: Event[];
  kinds: { kind: string; count: number; top: Place[] }[];
  indoor: Place[];
  freeEvents: Event[];
  /** Events on during the coming weekend (this one, from Saturday on). */
  weekend: Event[];
  freePlaces: Place[];
  playgrounds: Place[];
}

/** What a city page shows for one town. `events` must already be upcoming and sorted by start (getData does both). */
export function cityFacts(town: string, allEvents: Event[], allPlaces: Place[], today: string): CityFacts {
  const events = located(allEvents.filter((e) => e.town === town), today);
  const sat = weekendOf(today), sun = addDays(sat, 1);
  const places = allPlaces.filter((p) => p.town === town);
  const kinds = PLACE_KINDS.map((kind) => {
    const of = places.filter((p) => p.kind === kind);
    return { kind, count: of.length, top: best(of).slice(0, PER_KIND) };
  }).filter((k) => k.count > 0);
  return {
    events, places, soon: events.slice(0, SOON), kinds,
    indoor: best(places.filter((p) => indoorGuess(p.indoor, [p.kind]) === true)),
    freeEvents: events.filter((e) => e.price?.free),
    weekend: events.filter((e) => e.start <= sun && (e.end || e.start) >= sat),
    freePlaces: best(places.filter((p) => p.free)),
    playgrounds: best(places.filter((p) => p.kind === "playground")),
  };
}

type TownRec = { name: string; en?: string; zh?: string };

/** Town names for townName(): the region's towns and the places-only towns. */
export const cityNames = (towns: TownRec[]): TownRec[] =>
  [...towns, ...Object.entries(MORE_TOWN_NAMES).filter(([name]) => !towns.some((t) => t.name === name)).map(([name, n]) => ({ name, ...n }))];

/**
 * The towns that get a city page, with their slugs, biggest first: the towns with events lead, since a page with
 * this weekend's events is the better answer. A town with fewer than CITY_MIN events and places gets none.
 */
export function cityTowns(towns: { name: string }[], events: Event[], places: Place[], today: string) {
  // Every page asks (footer, other cities, sitemap); the data is the same all build long.
  const hit = memo.get(places);
  if (hit && hit.towns === towns && hit.events === events && hit.today === today) return hit.rows;
  const rows = listTowns(towns, events, places, today);
  memo.set(places, { towns, events, today, rows });
  return rows;
}
/** How much a city page has: an upcoming event counts like ten places. */
const size = (r: { events: number; places: number }) => r.events * 10 + r.places;
type Row = { name: string; slug: string; events: number; places: number; more: boolean };
const memo = new WeakMap<Place[], { towns: object; events: Event[]; today: string; rows: Row[] }>();

function listTowns(towns: { name: string }[], events: Event[], places: Place[], today: string): Row[] {
  const ours = new Set(towns.map((t) => t.name));
  const more = Object.keys(MORE_TOWN_NAMES).filter((n) => !ours.has(n));
  const rows = [...towns.map((t) => t.name), ...more].map((name) => {
    const f = cityFacts(name, events, places, today);
    return { name, slug: townSlug(name), events: f.events.length, places: f.places.length, more: !ours.has(name) };
  }).filter((t) => t.events + t.places >= CITY_MIN);
  return rows.sort((a, b) => size(b) - size(a));
}
