// Turns the raw collections into normalized places and events.
// Merge order for an event: imported < answers < overrides (human fixes always win).
// Pure functions without Astro imports, so `node --test` can run them directly.
import type { Event, Geo, Language, Place, Tally } from "./types.ts";

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
 * Fill in a position: keep a point (exact, venue, or an area such as a city district), otherwise
 * fall back to the town centre ("area"), otherwise "unknown". Unknown items are listed as tasks,
 * never on the map.
 */
export function resolveGeo(geo: Raw | undefined, town: string | undefined, towns: Town[]): Geo {
  if (geo?.lat != null && geo?.lon != null && geo.precision !== "unknown")
    return { lat: geo.lat, lon: geo.lon, precision: geo.precision ?? "exact" };
  const anchor = towns.find((t) => t.name === town);
  if (anchor) return { lat: anchor.lat, lon: anchor.lon, precision: "area" };
  return { precision: "unknown" };
}

/** The site's name for a town a parent typed: "Cologne" or "köln" is "Köln". Unknown names stay as typed. */
export function canonicalTown<T extends Town & { en?: string; zh?: string }>(name: string, towns: T[]): string {
  const key = name.trim().toLowerCase();
  return towns.find((t) => [t.name, t.en, t.zh].some((n) => n?.toLowerCase() === key))?.name ?? name;
}

/**
 * Towns of places parents suggested that the region doesn't list yet (Merzenich), so they show up in
 * the "Around" picker. Anchored at the first such place's pin; a place without a pin adds nothing.
 */
export function townsFromPlaces(places: Place[], towns: Town[]): Town[] {
  const out: Town[] = [];
  for (const p of places) {
    if (!p.town || p.geo.lat == null || p.geo.lon == null || p.geo.precision === "area" || p.geo.precision === "unknown") continue;
    if ([...towns, ...out].some((t) => t.name === p.town)) continue;
    out.push({ name: p.town, lat: p.geo.lat, lon: p.geo.lon });
  }
  return out;
}

// A country typed after the town ("…, Netherlands"); the page shows the town on its own.
const COUNTRY = /^(germany|deutschland|netherlands|the netherlands|niederlande|nederland|belgium|belgien|belgië|belgique|luxembourg|luxemburg|france|frankreich|austria|österreich|switzerland|schweiz|de|nl|be|lu)$/i;

/**
 * Parents often type the whole address as the street ("Steinpfahl 4a, 52399 Merzenich"), and the
 * town has its own field, so the page read "…Merzenich, Merzenich". Moves a trailing postcode and
 * town out of the street: German "52399 Merzenich", Dutch "6468 PH Kerkrade", Belgian "4700 Eupen",
 * with or without a country after it.
 */
export function splitStreet(street: string | undefined, postcode?: string): { street?: string; postcode?: string } {
  const parts = String(street ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length > 2 && COUNTRY.test(parts[parts.length - 1])) parts.pop();
  const m = parts.length > 1 ? /^(?:[A-Z]{1,2}-)?(\d{4,5}(?: ?[A-Z]{2})?)\s+\S/.exec(parts[parts.length - 1]) : null;
  if (!m) return { street, postcode };
  return { street: parts.slice(0, -1).join(", "), postcode: postcode ?? m[1] };
}

export function normalizePlace(id: string, raw: Raw, answer: Raw | undefined, towns: Town[]): Place {
  const { street, postcode } = splitStreet(raw.address.street, raw.address.postcode);
  const facilities = { ...(raw.facilities ?? {}) };
  for (const [f, v] of Object.entries((answer?.facilities ?? {}) as Raw)) facilities[f] = v;
  return {
    type: "place",
    id,
    kind: raw.kind,
    name: raw.name,
    town: raw.address.town,
    street,
    near: raw.address.near,
    district: raw.address.district,
    postcode,
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
    by: raw.by,
    byId: raw.by_id,
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
    ...(raw.venue_guess && !raw.venue && !place ? { venueGuess: raw.venue_guess } : {}),
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
    // The importer guesses from the title; a hand-written event or an override is an editor's word.
    languageFrom: raw.language ? (layers.override?.language || base.origin !== "cityklub" ? "editor" : "guess") : undefined,
    note: raw.note,
    trust: raw.trust ?? { level: "community" },
    by: raw.by,
    byId: raw.by_id,
    website: raw.website ?? raw.source_url ?? place?.website,
    origin: raw.origin === "cityklub" ? { name: raw.attribution ?? "cityklub", url: raw.source_url } : undefined,
  };
}

/**
 * Adds cached machine translations (data/translations/zh.json): a Chinese title for events whose
 * title is still plain German, a Chinese name for places. A translation written by hand wins.
 */
export function applyTranslations<T extends Event | Place>(item: T, caches: Partial<Record<"en" | "zh", Record<string, string>>>): T {
  const langs = (Object.keys(caches) as ("en" | "zh")[]).sort();
  if (item.type === "place") {
    const names = Object.fromEntries(langs.filter((l) => caches[l]![item.name]).map((l) => [l, caches[l]![item.name]]));
    return Object.keys(names).length ? { ...item, names: { ...item.names, ...names } } : item;
  }
  const ev = item as Event;
  if (typeof ev.title !== "string") return item;
  const de = ev.title;
  const found = langs.filter((l) => caches[l]![de]);
  if (!found.length) return item;
  // A title that is already English comes back unchanged: shown as is, without a German line beneath.
  const machine = found.filter((l) => caches[l]![de] !== de);
  return { ...ev, title: { de, ...Object.fromEntries(found.map((l) => [l, caches[l]![de]])) }, ...(machine.length ? { machine } : {}) } as T;
}

/**
 * Parents' answers to "How much German do you need?" replace the title guess once one answer leads.
 * A tie keeps the guess; an editor's answer is never overruled, only shown with the votes.
 */
export function applyEventTally(e: Event, t: Tally | undefined, places?: Map<string, Place>): Event {
  e = fillWhere(fillAnswers(e, t), t, places);
  if (t?.asks && Object.keys(t.asks).length) e = { ...e, asks: t.asks };
  const votes = t?.lang;
  if (!votes || !Object.values(votes).some((n) => n! > 0)) return e;
  const out = { ...e, languageVotes: votes };
  if (e.languageFrom === "editor") return out;
  const [top, second] = (Object.entries(votes) as [Language, number][]).sort((a, b) => b[1] - a[1]);
  if (!second || top[1] > second[1]) Object.assign(out, { language: top[0], languageFrom: "parents" });
  return out;
}

/** Fills a missing time or price with what parents agreed on. Anything already known stays. */
function fillAnswers(e: Event, t: Tally | undefined): Event {
  const a = t?.answers;
  if (!a) return e;
  const out = { ...e };
  if (!out.time && a.time) out.time = a.time;
  if (!out.price && a.price) out.price = a.price === "free" || /^(free|frei|kostenlos|gratis|免费)$/i.test(a.price) ? { free: true } : { free: false, text: a.price };
  return out;
}

/** A "where" answer that is only a picked point ("50.80312, 6.48211") has no words worth showing. */
export const isPointText = (s: string) => /^\s*-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+\s*$/.test(s);

/**
 * Fills a vague location with where parents agreed it is: a place we know, a picked point, or
 * just their words (an address the maps button can search for). A known street is never replaced.
 */
function fillWhere(e: Event, t: Tally | undefined, places?: Map<string, Place>): Event {
  const a = t?.answers;
  if (!a?.where || e.geo.precision === "exact") return e;
  const words = isPointText(a.where) ? undefined : a.where;
  const place = a.whereAt?.place ? places?.get(a.whereAt.place) : undefined;
  if (place && place.geo.precision === "exact") return { ...e, place: place.id, venue: place.name, geo: place.geo };
  if (a.whereAt) return { ...e, geo: { lat: a.whereAt.lat, lon: a.whereAt.lon, precision: "exact" }, ...(words ? { address: words } : {}) };
  return words ? { ...e, address: words } : e;
}

/** Shift every date by `days`. Used only by the demo so its fictional events stay in the future. */
export function shiftDays(d: string, days: number): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return ymd(t);
}

/** What parents' votes say about a facility: more yes → yes, more no → no, a tie (or nothing) → unknown. */
export function voteStatus(v: { yes: number; no: number }): "yes" | "no" | "unknown" {
  return v.yes > v.no ? "yes" : v.no > v.yes ? "no" : "unknown";
}

/**
 * Adds what parents sent through the inbox and taps (counted at build time) to a place.
 * Votes decide a facility nobody else has filled in (see voteStatus). Facts from a source or a
 * moderator are never overruled, only annotated with the votes.
 */
export function applyTally(p: Place, t: Tally | undefined): Place {
  if (!t) return p;
  const facilities = { ...p.facilities };
  for (const [f, v] of Object.entries(t.fac ?? {})) {
    const cur = facilities[f] ?? { status: "unknown" as const, confirmed: 0 };
    facilities[f] = cur.status === "unknown" ? { status: voteStatus(v), confirmed: 0, votes: v, byVotes: true } : { ...cur, votes: v };
  }
  let visits = p.visits;
  if (t.visits) {
    const good_for: Record<string, number> = { ...(visits?.good_for ?? {}) } as Record<string, number>;
    for (const [g, n] of Object.entries(t.visits.good_for)) good_for[g] = (good_for[g] ?? 0) + n;
    visits = { count: (visits?.count ?? 0) + t.visits.count, again: (visits?.again ?? 0) + t.visits.again, good_for };
  }
  // Opening hours parents agreed on fill the gap; hours from a source are never replaced.
  const hours = p.hours ?? t.answers?.hours;
  // A point parents agreed on pins a place that only had its town centre.
  const at = t.answers?.whereAt;
  const geo = at && p.geo.precision !== "exact" ? { lat: at.lat, lon: at.lon, precision: "exact" as const } : p.geo;
  return { ...p, facilities, visits, geo, ...(hours ? { hours } : {}), ...(t.asks && Object.keys(t.asks).length ? { asks: t.asks } : {}), tips: [...(p.tips ?? []), ...(t.tips ?? [])] };
}
