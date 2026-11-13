// "Nearby for afterwards" on event pages: the closest playground and family café within a short walk.
import { metres } from "./toilets.ts";
import type { Place } from "./types.ts";

export const AFTER_M = 1000;
const KINDS = ["playground", "cafe"] as const;

// Playgrounds and family cafés with an exact point, worked out once per build (every event page asks).
const CANDIDATES = new WeakMap<Place[], Place[]>();
function candidates(list: Place[]) {
  let c = CANDIDATES.get(list);
  if (!c) CANDIDATES.set(list, (c = list.filter((p) => p.geo.precision === "exact" && p.geo.lat != null && p.geo.lon != null && (KINDS as readonly string[]).includes(p.kind))));
  return c;
}

/** The nearest playground, then the nearest family café, each within AFTER_M of the point. */
export function afterNear(lat: number, lon: number, places: Place[], skip?: string): { p: Place; m: number }[] {
  const close = candidates(places)
    .filter((p) => p.id !== skip && Math.abs(p.geo.lat! - lat) < 0.01 && Math.abs(p.geo.lon! - lon) < 0.015)
    .map((p) => ({ p, m: metres(lat, lon, p.geo.lat!, p.geo.lon!) }))
    .filter((x) => x.m <= AFTER_M)
    .sort((a, b) => a.m - b.m);
  return KINDS.map((k) => close.find((x) => x.p.kind === k)).filter((x): x is { p: Place; m: number } => !!x);
}
