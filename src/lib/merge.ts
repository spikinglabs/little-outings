// Turns the raw collections into normalized places and events.
// Merge order for an event: imported < answers < overrides (human fixes always win).
// Pure functions without Astro imports, so `node --test` can run them directly.
import type { Event, Geo, Place, Tally } from "./types.ts";

type Raw = Record<string, any>;
export type Town = { name: string; lat: number; lon: number };

const ymd = (d: Date | string) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/** Shallow merge where later layers win, but `undefined` never erases a value. */
function layer<T extends Raw>(...parts: (Raw | undefined)[]): T {
  const out: Raw = {};
  for (const p of parts) for (const [k, v] of Object.entries(p ?? {})) if (v !== undefined) out[k] = v;
  return out as T;
}

/**
 * Fill in a position: keep exact or venue points, otherwise fall back to the town
 * centre ("area"), otherwise "unknown". Unknown items are listed as tasks, never on the map.
 */
export function resolveGeo(geo: Raw | undefined, town: string | undefined, towns: Town[]): Geo {
  const hasPoint = geo?.lat != null && geo?.lon != null;
  if (hasPoint && geo!.precision !== "area" && geo!.precision !== "unknown")
    return { lat: geo!.lat, lon: geo!.lon, precision: geo!.precision ?? "exact" };
  const anchor = towns.find((t) => t.name === town);
  if (anchor) return { lat: anchor.lat, lon: anchor.lon, precision: "area" };
  if (hasPoint) return { lat: geo!.lat, lon: geo!.lon, precision: "area" };
  return { precision: "unknown" };
}

export function normalizePlace(id: string, raw: Raw, answer: Raw | undefined, towns: Town[]): Place {
  const facilities = { ...(raw.facilities ?? {}) };
  for (const [f, v] of Object.entries((answer?.facilities ?? {}) as Raw)) facilities[f] = v;
  return {
    type: "place",
    id,
    kind: raw.kind,
    name: raw.name,
    town: raw.address.town,
    street: raw.address.street,
    postcode: raw.address.postcode,
    geo: resolveGeo(answer?.geo ?? raw.geo, raw.address.town, towns),
    hours: answer?.hours ?? raw.hours,
    ages: raw.ages,
    indoor: raw.indoor,
    free: raw.free,
    facilities,
    rating: raw.rating,
    quotes: raw.quotes ?? [],
    visits: raw.visits,
    note: raw.note,
    trust: raw.trust ?? { level: "community" },
    website: raw.website,
  };
}

export function normalizeEvent(
  id: string,
  base: Raw,
  layers: { answer?: Raw; override?: Raw },
  places: Map<string, Place>,
  towns: Town[],
): Event | null {
  const raw = layer<Raw>(base, layers.answer?.fields, layers.answer?.geo && { geo: layers.answer.geo }, layers.override);
  if (raw.hidden) return null;
  const place = raw.place ? places.get(raw.place) : undefined;
  if (raw.place && !place) throw new Error(`event "${id}": place "${raw.place}" does not exist`);
  const town = raw.town ?? place?.town;
  const geo = raw.geo?.lat != null || !place ? resolveGeo(raw.geo, town, towns) : place.geo;
  const start = ymd(raw.start);
  return {
    type: "event",
    id,
    title: raw.title,
    place: raw.place,
    venue: raw.venue ?? place?.name,
    town,
    geo,
    start,
    end: raw.end ? ymd(raw.end) : start,
    time: raw.time,
    price: raw.price ?? (place?.free ? { free: true } : undefined),
    ages: raw.ages ?? place?.ages,
    indoor: raw.indoor ?? place?.indoor,
    tags: raw.tags ?? [],
    language: raw.language,
    note: raw.note,
    trust: raw.trust ?? { level: "community" },
    website: raw.website ?? raw.source_url ?? place?.website,
    origin: raw.origin === "cityklub" ? { name: raw.attribution ?? "cityklub", url: raw.source_url } : undefined,
  };
}

/**
 * Adds cached machine translations (data/translations/zh.json): a Chinese title for events whose
 * title is still plain German, a Chinese name for places. A translation written by hand wins.
 */
export function applyTranslations<T extends Event | Place>(item: T, zh: Record<string, string>): T {
  if (item.type === "place") return zh[item.name] ? { ...item, names: { ...item.names, zh: zh[item.name] } } : item;
  const ev = item as Event;
  if (typeof ev.title !== "string" || !zh[ev.title]) return item;
  return { ...ev, title: { de: ev.title, zh: zh[ev.title] }, machine: ["zh"] } as T;
}

/** Shift every date by `days`. Used only by the demo so its fictional events stay in the future. */
export function shiftDays(d: string, days: number): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return ymd(t);
}

/** Votes that settle an unknown facility: this many parents say yes and nobody says no. */
export const VOTES_TO_SETTLE = 3;

/**
 * Adds what parents sent through the inbox (counted at build time) to a place.
 * Facility votes always show; they turn an unknown "?" into a yes once VOTES_TO_SETTLE agree
 * and nobody disagrees. Facts from a source or a moderator are never overruled, only annotated.
 */
export function applyTally(p: Place, t: Tally | undefined): Place {
  if (!t) return p;
  const facilities = { ...p.facilities };
  for (const [f, v] of Object.entries(t.fac ?? {})) {
    const cur = facilities[f] ?? { status: "unknown" as const, confirmed: 0 };
    const settles = cur.status === "unknown" && v.yes >= VOTES_TO_SETTLE && v.no === 0;
    facilities[f] = settles ? { status: "yes", confirmed: v.yes, votes: v } : { ...cur, votes: v };
  }
  let visits = p.visits;
  if (t.visits) {
    const good_for: Record<string, number> = { ...(visits?.good_for ?? {}) } as Record<string, number>;
    for (const [g, n] of Object.entries(t.visits.good_for)) good_for[g] = (good_for[g] ?? 0) + n;
    visits = { count: (visits?.count ?? 0) + t.visits.count, again: (visits?.again ?? 0) + t.visits.again, good_for };
  }
  return { ...p, facilities, visits, tips: [...(p.tips ?? []), ...(t.tips ?? [])] };
}
