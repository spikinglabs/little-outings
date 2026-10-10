// Pins places parents suggested: content/places/community/*.yaml with an address but no point
// get one from OpenStreetMap's Nominatim, run before every build (the files change only in
// that build's checkout; add `geo:` to a file by hand to fix a pin for good).
// Without a point a place falls back to its town centre, or isn't on the map at all when the
// town isn't one of the site's towns. A failed lookup only logs; the next build tries again.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const DIR = "content/places/community";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

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

/** The `geo:` line for a Nominatim hit: a house number is the place itself, a street only nearby. */
export function geoLine(hit) {
  const lat = Number(hit?.lat), lon = Number(hit?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const precision = hit.address?.house_number ? "exact" : "venue";
  return `geo: { lat: ${lat.toFixed(6)}, lon: ${lon.toFixed(6)}, precision: ${precision} }`;
}

/** Adds the geo line to a place file's text, after its address. */
export function withGeo(text, line) {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith("address:"));
  lines.splice(at < 0 ? lines.length - 1 : at + 1, 0, line);
  return lines.join("\n");
}

async function lookup(q) {
  const url = `${NOMINATIM}?${new URLSearchParams({ q, format: "jsonv2", limit: "1", countrycodes: "de", addressdetails: "1" })}`;
  const res = await fetch(url, { headers: { "user-agent": "little-outings place pins (+https://outings.allo.land)" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return (await res.json())[0] ?? null;
}

async function main() {
  if (!existsSync(DIR)) return;
  let pinned = 0, missed = 0;
  for (const name of readdirSync(DIR).filter((f) => f.endsWith(".yaml")).sort()) {
    const path = join(DIR, name);
    const text = readFileSync(path, "utf8");
    const place = load(text) ?? {};
    if (place.geo?.lat != null) continue;
    const q = queryOf(place.address);
    if (!q) continue;
    if (pinned + missed) await new Promise((r) => setTimeout(r, 1100)); // Nominatim: one request a second
    try {
      const line = geoLine(await lookup(q));
      if (!line) { missed++; console.log(`${name}: nothing found for "${q}"`); continue; }
      writeFileSync(path, withGeo(text, line));
      pinned++;
      console.log(`${name}: ${line}`);
    } catch (err) {
      missed++;
      console.log(`${name}: ${err.message}`);
    }
  }
  console.log(`Pinned ${pinned} parent-suggested places${missed ? `, ${missed} still without a pin` : ""}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
