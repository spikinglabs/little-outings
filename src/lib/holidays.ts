/**
 * School holidays for Discover's "Holidays" choice. data/school-holidays.json (scripts/fetch-holidays.mjs)
 * lists each state's holidays; every town has a state (content/regions). The choice shows only while the
 * home town's holidays are on or start before the last day events are listed for.
 */
export type Period = { start: string; end: string; name: string };

/** The holiday that is on, or the next one starting by `last`, as dates clipped to [today, last]. */
export function holidayFor(periods: Period[] | undefined, today: string, last: string): (Period & { from: string; to: string }) | null {
  const p = (periods ?? []).find((h) => h.end >= today && h.start <= last);
  if (!p) return null;
  return { ...p, from: p.start < today ? today : p.start, to: p.end > last ? last : p.end };
}

/**
 * Each town's state: its own, or for towns that came from parents' places the nearest town's within
 * about 100 km. Farther away (another country, say) a town gets none, and no "Holidays" choice.
 */
export function townStates(towns: { name: string; lat: number; lon: number; state?: string }[]): Record<string, string> {
  const known = towns.filter((t) => t.state);
  const out: Record<string, string> = {};
  for (const t of towns) {
    if (t.state) { out[t.name] = t.state; continue; }
    const near = known.reduce<{ d: number; s: string } | null>((best, k) => {
      const d = (k.lat - t.lat) ** 2 + ((k.lon - t.lon) * Math.cos((t.lat * Math.PI) / 180)) ** 2;
      return !best || d < best.d ? { d, s: k.state! } : best;
    }, null);
    if (near && near.d < 1) out[t.name] = near.s; // in degrees of latitude squared: 1 is about 111 km
  }
  return out;
}
