// Where an event without an address may be, so a parent who knows can pick it with one tap
// instead of typing it. Guesses only, shown as a question ("Is it at …?"); nothing here goes on
// the page as a fact until two parents pick the same spot (admin/lib/answers.js).
// Pure functions without Astro imports, so `node --test` can run them directly.
import { fold } from "./fold.ts";
import type { Ask, Event, Place } from "./types.ts";

const MAX = 3;
/** Place names too plain to find in a title: "Spielplatz" is in many titles and means none of them. */
const MIN_NAME = 8;
const USUAL_MIN = 2;

const label = (name: string, street?: string) => [name, street].filter(Boolean).join(", ");
const exact = (g: { precision: string; lat?: number; lon?: number }) => g.precision === "exact" && g.lat != null && g.lon != null;

/**
 * Prepares the places and calendar venues of every town once, and returns the guesser for one
 * event: up to three spots, best first:
 * 1. a place we know in the same town whose name is the event's venue, or appears in its title;
 * 2. the event's own venue, where other events from the same calendar at that venue have a spot;
 * 3. when it names no venue: the venues its calendar uses most in that town (`usual`), but only
 *    those with at least USUAL_MIN events. A venue used once (a cemetery for a funeral concert) was
 *    offered for a game afternoon.
 */
export function whereGuesser(events: Event[], places: Place[]): (e: Event) => Ask[] {
  const placesIn = new Map<string, { name: string; p: Place }[]>();
  for (const p of places) {
    if (!exact(p.geo)) continue;
    const k = fold(p.town);
    if (!placesIn.has(k)) placesIn.set(k, []);
    placesIn.get(k)!.push({ name: fold(p.name).trim(), p });
  }
  // calendar + town → its venues with a known spot, most used first
  const venuesOf = new Map<string, Map<string, { n: number; ev: Event }>>();
  for (const o of events) {
    if (!o.origin || !o.venue || !exact(o.geo)) continue;
    const k = `${o.origin.name}|${fold(o.town)}`;
    if (!venuesOf.has(k)) venuesOf.set(k, new Map());
    const v = fold(o.venue).trim();
    const c = venuesOf.get(k)!.get(v) ?? { n: 0, ev: o };
    c.n++;
    venuesOf.get(k)!.set(v, c);
  }

  return (e) => {
    if (exact(e.geo) || e.address || !e.town) return [];
    const out: Ask[] = [];
    const seen = new Set<string>();
    const add = (a: Ask) => {
      const k = a.at?.place ?? `${a.at?.lat?.toFixed(3)},${a.at?.lon?.toFixed(3)}`;
      if (out.length < MAX && !seen.has(k)) { seen.add(k); out.push(a); }
    };
    const town = fold(e.town);
    const venue = fold(e.venue).trim();
    const title = fold(typeof e.title === "string" ? e.title : e.title.de);
    for (const { name, p } of placesIn.get(town) ?? []) {
      const hit = (venue && (name === venue || (venue.length >= MIN_NAME && name.includes(venue)) || (name.length >= MIN_NAME && venue.includes(name))))
        || (name.length >= MIN_NAME && title.includes(name));
      if (hit) add({ value: label(p.name, p.street), at: { lat: p.geo.lat!, lon: p.geo.lon!, place: p.id } });
    }
    if (e.origin) {
      const used = [...(venuesOf.get(`${e.origin.name}|${town}`) ?? new Map()).entries()]
        .filter(([k, c]) => (venue ? k === venue || k.includes(venue) || venue.includes(k) : c.n >= USUAL_MIN))
        .sort((a, b) => b[1].n - a[1].n);
      for (const [, { ev }] of used) add({ value: ev.venue!, at: { lat: ev.geo.lat!, lon: ev.geo.lon!, ...(ev.place ? { place: ev.place } : {}) }, ...(venue ? {} : { usual: true }) });
    }
    return out;
  };
}
