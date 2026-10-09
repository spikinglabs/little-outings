// Every missing optional field is a gap, and every gap is a quick task for parents.
// Pure functions without Astro imports, so `node --test` can run them directly.
import type { Event, Gap, Item, Place } from "./types.ts";

/** Facilities worth asking about, per kind of place. The first unknown two become tasks. */
const ASK: Record<string, string[]> = {
  cafe: ["changing_table", "highchairs", "kids_menu", "playground"],
  farm: ["toilets", "changing_table", "playground", "stroller_friendly"],
  playground: ["toilets", "stroller_friendly", "parking"],
  park: ["toilets", "stroller_friendly", "playground"],
  museum: ["changing_table", "stroller_friendly", "toilets"],
  pool: ["changing_table", "parking", "toilets"],
  zoo: ["changing_table", "stroller_friendly", "playground"],
};

export function gapsOf(item: Item): Gap[] {
  const gaps: Gap[] = [];
  if (item.type === "event") {
    if (item.geo.precision !== "exact") gaps.push({ type: "where" });
    if (!item.time) gaps.push({ type: "time" });
    if (!item.price) gaps.push({ type: "price" });
    if (item.trust.level === "community") gaps.push({ type: "still" });
    return gaps;
  }
  if (item.geo.precision !== "exact") gaps.push({ type: "where" });
  if (!item.hours) gaps.push({ type: "hours" });
  (ASK[item.kind] ?? [])
    .filter((f) => (item.facilities[f]?.status ?? "unknown") === "unknown")
    .slice(0, 2)
    .forEach((feature) => gaps.push({ type: "fac", feature }));
  return gaps;
}

export interface Task {
  id: string;
  type: "event" | "place";
  gaps: Gap[];
  score: number;
}

/**
 * Items with gaps, most useful first: soon events before places, and missing
 * locations before details. All gaps of one item stay together in one task.
 */
export function tasksOf(events: Event[], places: Place[], today: string): Task[] {
  const days = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 864e5);
  const weight = (g: Gap) => (g.type === "where" ? 0 : g.type === "time" || g.type === "still" ? 5 : 10);
  const tasks: Task[] = [];
  for (const e of events) {
    if (e.end < today) continue;
    const gaps = gapsOf(e);
    if (gaps.length) tasks.push({ id: e.id, type: "event", gaps, score: Math.max(0, days(e.start)) + Math.min(...gaps.map(weight)) });
  }
  for (const p of places) {
    const gaps = gapsOf(p);
    if (gaps.length) tasks.push({ id: p.id, type: "place", gaps, score: 40 + Math.min(...gaps.map(weight)) });
  }
  return tasks.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
}
