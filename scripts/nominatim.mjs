// OpenStreetMap's Nominatim, shared by the scripts that pin places and events.
// Answers are kept in PINS_CACHE (the deploy keeps that file between builds), so each query is
// asked once, not on every build. A miss is kept too, and asked again after MISS_DAYS.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
// Germany and its neighbours: families near the border go to GaiaZOO in Kerkrade (NL) too.
const COUNTRIES = "de,nl,be,lu,fr,ch,at,cz,pl,dk";
const MISS_DAYS = 30;

const CACHE = process.env.PINS_CACHE || "";
const cache = CACHE && existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
export const stats = { asked: 0 };

const today = () => new Date().toISOString().slice(0, 10);
const daysSince = (date) => (Date.parse(today()) - Date.parse(date)) / 864e5;

/**
 * The first hit for `q`, or null. `near` ([lat, lon, km]) keeps the search to a box around a
 * town, so a venue name like "Haus der Familie" can't land in another city.
 */
export async function lookup(q, near) {
  const box = near ? viewbox(near) : "";
  const key = box ? `${q} @${box}` : q;
  const kept = cache[key];
  if (kept && !(kept.miss && daysSince(kept.miss) >= MISS_DAYS)) return kept.miss ? null : kept;
  if (stats.asked++) await new Promise((r) => setTimeout(r, 1100)); // Nominatim: one request a second
  const params = { q, format: "jsonv2", limit: "1", countrycodes: COUNTRIES, addressdetails: "1" };
  if (box) Object.assign(params, { viewbox: box, bounded: "1" });
  const res = await fetch(`${NOMINATIM}?${new URLSearchParams(params)}`, {
    headers: { "user-agent": "little-outings place pins (+https://outings.allo.land)" },
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const hit = (await res.json())[0] ?? null;
  // Only what the callers read.
  cache[key] = hit ? { lat: hit.lat, lon: hit.lon, address: { house_number: hit.address?.house_number } } : { miss: today() };
  return hit ? cache[key] : null;
}

/** Nominatim's viewbox (west,north,east,south) for `km` around a point. */
export function viewbox([lat, lon, km]) {
  const dLat = km / 111, dLon = km / (111 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat + dLat, lon + dLon, lat - dLat].map((n) => n.toFixed(3)).join(",");
}

export function saveCache() {
  if (CACHE) writeFileSync(CACHE, JSON.stringify(cache, null, 1) + "\n");
}
