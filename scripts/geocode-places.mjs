// Pins what parents suggested: content/places/community/*.yaml with an address and
// content/events/community/*.yaml with a venue or town, but no point, get one from OpenStreetMap's Nominatim, run before every build (the files change only in
// that build's checkout; add `geo:` to a file by hand to fix a pin for good).
// Without a point a place falls back to its town centre, or isn't on the map at all when the
// town isn't one of the site's towns. A failed lookup only logs; the next build tries again.
// Answers are kept in PINS_CACHE (the deploy keeps that file between builds), so each address
// is asked once, not on every build.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const PLACES = "content/places/community";
const EVENTS = "content/events/community";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
// Germany and its neighbours: families near the border go to GaiaZOO in Kerkrade (NL) too.
const COUNTRIES = "de,nl,be,lu,fr,ch,at,cz,pl,dk";

/** What to ask Nominatim for a place's address, or null when there is no street to find. */
export function queryOf(address) {
  const street = String(address?.street ?? "").trim();
  if (!street) return null;
  const town = String(address?.town ?? "").trim();
  const postcode = String(address?.postcode ?? "").trim();
  // "Steinpfahl 4a, 52399 Merzenich" already names its town.
  const named = town && street.toLowerCase().includes(town.toLowerCase());
  return [street, named ? "" : [postcode, town].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

/**
 * What to ask for an event, best first: its venue in its town ("Bürgerhalle Koslar, Jülich-Koslar"),
 * then the town alone, which only says "somewhere in" it.
 */
export function eventQueries(event) {
  const venue = String(event?.venue ?? "").trim(), town = String(event?.town ?? "").trim();
  if (!town) return [];
  return [...(venue ? [{ q: `${venue}, ${town}`, precision: "venue" }] : []), { q: town, precision: "area" }];
}

/**
 * The `geo:` line for a Nominatim hit: a house number is the place itself, a street only nearby.
 * `precision` overrides that, for an event's venue or town.
 */
export function geoLine(hit, precisionOf) {
  const lat = Number(hit?.lat), lon = Number(hit?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const precision = precisionOf ?? (hit.address?.house_number ? "exact" : "venue");
  return `geo: { lat: ${lat.toFixed(6)}, lon: ${lon.toFixed(6)}, precision: ${precision} }`;
}

/** Adds the geo line to a place file's text, after its address. */
export function withGeo(text, line) {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith("address:"));
  lines.splice(at < 0 ? lines.length - 1 : at + 1, 0, line);
  return lines.join("\n");
}

const CACHE = process.env.PINS_CACHE || "";
const cache = CACHE && existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
let asked = 0;

async function lookup(q) {
  if (cache[q]) return cache[q];
  if (asked++) await new Promise((r) => setTimeout(r, 1100)); // Nominatim: one request a second
  const url = `${NOMINATIM}?${new URLSearchParams({ q, format: "jsonv2", limit: "1", countrycodes: COUNTRIES, addressdetails: "1" })}`;
  const res = await fetch(url, { headers: { "user-agent": "little-outings place pins (+https://outings.allo.land)" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const hit = (await res.json())[0] ?? null;
  // Only what geoLine reads; a miss isn't kept, so a fixed address is found on the next build.
  if (hit) cache[q] = { lat: hit.lat, lon: hit.lon, address: { house_number: hit.address?.house_number } };
  return hit;
}

const files = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort().map((f) => join(dir, f)) : []);

/** The first query that finds something, as a geo line, or null. */
async function pin(queries) {
  for (const { q, precision } of queries) {
    const line = geoLine(await lookup(q), precision);
    if (line) return line;
  }
  return null;
}

async function main() {
  let pinned = 0, missed = 0;
  const todo = [
    ...files(PLACES).map((path) => [path, (d) => { const q = queryOf(d.address); return q ? [{ q }] : []; }]),
    ...files(EVENTS).map((path) => [path, eventQueries]),
  ];
  for (const [path, queriesOf] of todo) {
    const text = readFileSync(path, "utf8");
    const data = load(text) ?? {};
    if (data.geo?.lat != null || data.place) continue;
    const queries = queriesOf(data);
    if (!queries.length) continue;
    try {
      const line = await pin(queries);
      if (!line) { missed++; console.log(`${path}: nothing found for "${queries[0].q}"`); continue; }
      writeFileSync(path, withGeo(text, line));
      pinned++;
      console.log(`${path}: ${line}`);
    } catch (err) {
      missed++;
      console.log(`${path}: ${err.message}`);
    }
  }
  if (CACHE) writeFileSync(CACHE, JSON.stringify(cache, null, 1) + "\n");
  console.log(`Pinned ${pinned} parent-suggested places and events (${asked} asked Nominatim)${missed ? `, ${missed} still without a pin` : ""}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
