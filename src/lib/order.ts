/**
 * The order of Discover's list. "mixed" (the default) shuffles once a day per town, so every idea gets
 * its turn at the top, yet the list stays put when a parent goes to a card and back, and two parents
 * comparing on the same day see the same list. Days still follow each other (Saturday before Sunday),
 * and so do the parts of a day (morning, afternoon, evening). "soonest" and "nearest" are the plain sorts.
 * In "mixed", `fit` (lower first; lib/weather.ts) lifts what suits the day's weather within each part of a day,
 * and what's close comes before what's further out (distance bands, see `band`), so "Around Cologne" opens on Cologne.
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

/** Distance bands for "mixed": 0 in and around the town (up to 10 km), 1 up to 20 km, 2 further or unknown. */
export const band = (d?: number | null) => (d == null ? 2 : d <= 10 ? 0 : d <= 20 ? 1 : 2);

/**
 * Events in the chosen order. `from` is the first listed day: an event that began earlier counts from it.
 * In every order, long runs (exhibitions) come after the events that happen only then, until their last week.
 */
export function orderEvents<R extends Ev>(rows: R[], order: Order, from: string, today: string, seed: string, fit: (r: R, day: string) => number = () => 0): R[] {
  const day = (r: R) => (r.start < from ? from : r.start);
  // Each row's keys are worked out once, not in every comparison: Discover sorts thousands of rows on each tap.
  const keyed = rows.map((r) => ({ r, day: day(r), dist: far(r.dist), part: 0, band: 0, fit: 0, rank: 0 }));
  if (order === "mixed") for (const k of keyed) { k.part = partOfDay(k.r.time); k.band = band(k.r.dist); k.fit = fit(k.r, k.day); k.rank = rankOf(k.r.id, seed); }
  type K = (typeof keyed)[number];
  const cmp: (a: K, b: K) => number =
    order === "nearest" ? (a, b) => a.dist - b.dist
    : order === "soonest" ? (a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) || a.dist - b.dist
    : (a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) || a.part - b.part || a.band - b.band || a.fit - b.fit || a.rank - b.rank;
  const long = (r: R) => runsLong(r.start, r.end) && !lastChance(r.end, today);
  const short = keyed.filter((k) => !long(k.r)).sort(cmp);
  const runs = keyed.filter((k) => long(k.r)).sort(order === "mixed" ? (a, b) => a.band - b.band || a.fit - b.fit || a.rank - b.rank : cmp);
  return [...short, ...runs].map((k) => k.r);
}

/** Places in the chosen order: shuffled for "mixed" (close ones first), nearest first otherwise (they have no time). */
export function orderPlaces<R extends Pl>(rows: R[], order: Order, seed: string, fit: (r: R) => number = () => 0): R[] {
  const keyed = rows.map((r) => (order === "mixed" ? { r, z: band(r.dist), a: fit(r), b: rankOf(r.id, seed) } : { r, z: 0, a: far(r.dist), b: 0 }));
  return keyed.sort((x, y) => x.z - y.z || x.a - y.a || x.b - y.b).map((k) => k.r);
}

// rank() for the day's seed, remembered: the seed changes once a day or when the town does.
let rankSeed = "";
const ranks = new Map<string, number>();
function rankOf(id: string, seed: string): number {
  if (seed !== rankSeed) { rankSeed = seed; ranks.clear(); }
  let r = ranks.get(id);
  if (r == null) ranks.set(id, (r = rank(id, seed)));
  return r;
}
