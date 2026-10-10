// Street and district for OpenStreetMap places → data/places-geocode.json.
// Most playgrounds, parks and pools have no address tags, so their pages only knew the town.
// Nominatim's reverse lookup gives the nearest road and the district for each point. Run after
// fetch-osm-places.mjs by .github/workflows/places.yml; answers are kept, so each place is looked up
// once (and again only when it moves). Nominatim's policy: at most one request a second, a real
// user agent, results cached. Data © OpenStreetMap contributors, ODbL.
//
//   npm run streets:places                  # up to GEOCODE_MAX new places (default 2000)
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const PLACES = process.env.OSM_FILE || "data/places-osm.jsonl";
const OUT = process.env.GEOCODE_FILE || "data/places-geocode.json";
const MAX = Number(process.env.GEOCODE_MAX || 2000);
const URL_BASE = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org/reverse";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One Nominatim answer → { road, district, postcode }, without empty fields. */
export function fromNominatim(json) {
  const a = json?.address || {};
  const row = {
    road: a.road || a.pedestrian || a.footway || a.path || undefined,
    // The part of town parents know: Stadtteil first, then smaller or larger units.
    district: a.suburb || a.city_district || a.quarter || a.neighbourhood || a.village || a.hamlet || undefined,
    postcode: a.postcode || undefined,
  };
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v));
}

/** Cache key: the OSM id plus the rounded point, so a moved place is looked up again. */
export const keyOf = (row) => `${row.osm}@${row.lat.toFixed(4)},${row.lon.toFixed(4)}`;

async function main() {
  const rows = readFileSync(PLACES, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  const wanted = new Set(rows.map(keyOf));
  // Drop answers for places that are gone or moved.
  for (const k of Object.keys(cache)) if (!wanted.has(k)) delete cache[k];
  const todo = rows.filter((r) => !cache[keyOf(r)]).slice(0, MAX);
  let failed = 0;
  for (const r of todo) {
    const url = `${URL_BASE}?format=jsonv2&zoom=17&addressdetails=1&accept-language=de&lat=${r.lat}&lon=${r.lon}`;
    try {
      const res = await fetch(url, { headers: { "user-agent": "little-outings (spikinglabs) weekly place addresses; https://outings.allo.land" } });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      cache[keyOf(r)] = fromNominatim(await res.json());
    } catch (e) {
      failed++;
      if (failed === 1) console.error(`nominatim: ${e.message}`);
      if (failed >= 20) break; // blocked or down: keep what we have, try again next week
    }
    await sleep(1100);
  }
  // One place per line, so the weekly diff shows only what changed.
  const lines = Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`);
  writeFileSync(OUT, `{\n${lines.join(",\n")}\n}\n`);
  const left = rows.filter((r) => !cache[keyOf(r)]).length;
  console.log(`geocode: ${todo.length - failed} looked up, ${failed} failed, ${left} still without -> ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
