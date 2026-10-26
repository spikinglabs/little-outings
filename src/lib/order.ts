/**
 * The order of Discover's list. "mixed" (the default) shuffles once a day per town, so every idea gets
 * its turn at the top, yet the list stays put when a parent goes to a card and back, and two parents
 * comparing on the same day see the same list. Days still follow each other (Saturday before Sunday),
 * and so do the parts of a day (morning, afternoon, evening). "soonest" and "nearest" are the plain sorts.
 * In "mixed", `fit` (lower first; lib/weather.ts) lifts what suits the day's weather within each part of a day.
 */
import { lastChance, runsLong } from "./running.ts";

export type Order = "mixed" | "soonest" | "nearest";
export const ORDERS: Order[] = ["mixed", "soonest", "nearest"];

export type Ev = { id: string; start: string; end: string; time?: string; dist?: number | null };
export type Pl = { id: string; dist?: number | null };

/** A stable number for an id on a given day and town (cyrb53-style string hash). */
export function rank(id: string, seed: string): number {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (const ch of `${seed}|${id}`) {
    const c = ch.codePointAt(0)!;
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** 0 morning (before 12:00), 1 afternoon or no time given, 2 evening (from 17:00). */
export function partOfDay(time?: string): number {
  const m = time?.match(/(\d{1,2}):\d{2}/);
  if (!m) return 1;
  const h = +m[1];
  return h < 12 ? 0 : h < 17 ? 1 : 2;
}

const far = (d?: number | null) => d ?? 1e9;

/**
 * Events in the chosen order. `from` is the first listed day: an event that began earlier counts from it.
 * In every order, long runs (exhibitions) come after the events that happen only then, until their last week.
 */
export function orderEvents<R extends Ev>(rows: R[], order: Order, from: string, today: string, seed: string, fit: (r: R, day: string) => number = () => 0): R[] {
  const day = (r: R) => (r.start < from ? from : r.start);
  const suits = (a: R, b: R) => fit(a, day(a)) - fit(b, day(b));
  const cmp: (a: R, b: R) => number =
    order === "nearest" ? (a, b) => far(a.dist) - far(b.dist)
    : order === "soonest" ? (a, b) => day(a).localeCompare(day(b)) || far(a.dist) - far(b.dist)
    : (a, b) => day(a).localeCompare(day(b)) || partOfDay(a.time) - partOfDay(b.time) || suits(a, b) || rank(a.id, seed) - rank(b.id, seed);
  const long = (r: R) => runsLong(r.start, r.end) && !lastChance(r.end, today);
  const short = rows.filter((r) => !long(r)).sort(cmp);
  const runs = rows.filter(long).sort(order === "mixed" ? (a, b) => suits(a, b) || rank(a.id, seed) - rank(b.id, seed) : cmp);
  return [...short, ...runs];
}

/** Places in the chosen order: shuffled for "mixed", nearest first otherwise (they have no time). */
export function orderPlaces<R extends Pl>(rows: R[], order: Order, seed: string, fit: (r: R) => number = () => 0): R[] {
  return [...rows].sort(order === "mixed" ? (a, b) => fit(a) - fit(b) || rank(a.id, seed) - rank(b.id, seed) : (a, b) => far(a.dist) - far(b.dist));
}
