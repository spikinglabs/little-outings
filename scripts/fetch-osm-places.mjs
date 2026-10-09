// OpenStreetMap → data/places-osm.jsonl: family places around every town of the region.
// Run weekly by .github/workflows/places.yml (the Overpass API is slow and rate limited, so
// builds never call it). scripts/import-places.mjs turns the file into place pages.
// OSM data is © OpenStreetMap contributors, ODbL; the site credits it on the map and each place.
//
//   npm run fetch:osm                       # all region towns, default Overpass server
//   OVERPASS_URL=https://… npm run fetch:osm
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

const RADIUS = 6000; // metres around each town centre
const OUT = process.env.OSM_FILE || "data/places-osm.jsonl";
// Museums only when they are for children or hands-on; an art museum is rarely a family outing.
const KID_MUSEUM = /kinder|kids|jugend|natur|technik|science|spiel|mitmach|zoo|tier|eisenbahn|bahn|bergbau|feuerwehr|odysseum|schokolade|dino|planetar|sternwarte|bauernhof|freilicht/i;

/** Which family place an OSM object is, or null. Order matters: the most specific tag wins. */
export function kindOf(tags) {
  if (tags.tourism === "zoo" || ["petting_zoo", "wildlife_park", "safari_park"].includes(tags.zoo)) return "zoo";
  if (tags.shop === "farm" || tags.tourism === "farm" || tags.attraction === "farm") return "farm";
  if (tags.leisure === "playground" || tags.leisure === "indoor_play") return "playground";
  if (tags.leisure === "water_park" || tags.amenity === "public_bath"
    || (tags.leisure === "sports_centre" && /swimming/.test(tags.sport || ""))) return "pool";
  if (tags.tourism === "museum" && (tags.museum === "children" || KID_MUSEUM.test(tags.name || ""))) return "museum";
  if (tags.tourism === "theme_park") return "park";
  return null;
}

/** One bounding box around all towns (plus the radius); fromOsm drops what is not near a town. */
export function bbox(towns) {
  const pad = RADIUS / 111000;
  const lats = towns.map((t) => t.lat), lons = towns.map((t) => t.lon);
  const lonPad = pad / Math.cos((Math.max(...lats.map(Math.abs)) * Math.PI) / 180);
  const r = (n) => Math.round(n * 1e4) / 1e4;
  return [r(Math.min(...lats) - pad), r(Math.min(...lons) - lonPad), r(Math.max(...lats) + pad), r(Math.max(...lons) + lonPad)];
}

/** One small query per kind of tag: the public servers answer 504 to one big union. */
export function overpassQueries(towns) {
  const filters = [
    '["leisure"="playground"]["name"]', '["leisure"="indoor_play"]["name"]', '["tourism"="zoo"]["name"]',
    '["zoo"~"petting_zoo|wildlife_park|safari_park"]["name"]', '["shop"="farm"]["name"]', '["tourism"="farm"]["name"]',
    '["leisure"="water_park"]["name"]', '["amenity"="public_bath"]["name"]', '["leisure"="sports_centre"]["sport"~"swimming"]["name"]',
    '["tourism"="museum"]["name"]', '["tourism"="theme_park"]["name"]',
  ];
  return filters.map((f) => `[out:json][timeout:90][bbox:${bbox(towns).join(",")}];nwr${f};out center tags;`);
}

const rad = (d) => (d * Math.PI) / 180;
export function km([a, b], [c, d]) {
  const x = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

const url = (v) => {
  try { const u = new URL(String(v)); return /^https?:$/.test(u.protocol) ? u.toString() : undefined; } catch { return undefined; }
};

/** One Overpass element → one compact place row, or null. The town is the nearest region town. */
export function fromOsm(el, towns) {
  const tags = el.tags || {};
  const kind = kindOf(tags);
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  if (!kind || !tags.name || typeof lat !== "number" || typeof lon !== "number") return null;
  const near = towns.map((t) => ({ t, d: km([t.lat, t.lon], [lat, lon]) })).sort((a, b) => a.d - b.d)[0];
  if (!near || near.d > RADIUS / 1000 + 1) return null;
  const facilities = [];
  if (tags.changing_table === "yes" || tags["diaper"] === "yes") facilities.push("changing_table");
  if (tags.toilets === "yes") facilities.push("toilets");
  if (kind === "zoo" || kind === "farm") facilities.push("animals");
  if (tags.shop === "farm") facilities.push("farm_shop");
  if (kind === "zoo" && tags.playground === "yes") facilities.push("playground");
  return {
    osm: `${el.type}/${el.id}`,
    kind,
    name: tags.name,
    town: near.t.name,
    street: [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ") || undefined,
    postcode: tags["addr:postcode"] || undefined,
    lat: Math.round(lat * 1e6) / 1e6,
    lon: Math.round(lon * 1e6) / 1e6,
    hours: tags.opening_hours || undefined,
    website: url(tags.website || tags["contact:website"]),
    indoor: tags.leisure === "indoor_play" || tags.indoor === "yes" || kind === "museum" ? true : undefined,
    free: tags.fee === "no" ? true : tags.fee === "yes" ? false : kind === "playground" ? true : undefined,
    facilities,
  };
}

function loadTowns(dir) {
  return readdirSync(dir).filter((f) => f.endsWith(".yaml")).flatMap((f) => load(readFileSync(join(dir, f), "utf8")).towns || []);
}

const SERVERS = process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs one query, trying each server up to twice; returns its elements. */
async function overpass(query) {
  const errors = [];
  for (let round = 0; round < 2; round++) {
    for (const endpoint of SERVERS) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "little-outings (spikinglabs) weekly places import" },
          body: new URLSearchParams({ data: query }),
        });
        if (!res.ok) throw new Error(`answered ${res.status}`);
        const { elements = [], remark } = await res.json();
        // Overpass answers 200 with a remark when the query timed out or ran out of memory.
        if (remark) throw new Error(remark);
        return elements;
      } catch (e) {
        errors.push(`${new URL(endpoint).host}: ${e.message}`.slice(0, 200));
        await sleep(15000 * (round + 1));
      }
    }
  }
  throw new Error(`Overpass failed for ${query.slice(query.indexOf("nwr"))} (${errors.join("; ")})`);
}

async function main() {
  const towns = loadTowns(join(process.env.CONTENT_DIR || "content", "regions"));
  const elements = [];
  for (const q of overpassQueries(towns)) {
    elements.push(...(await overpass(q)));
    await sleep(2000);
  }
  if (!elements.length) throw new Error("Overpass returned no places; keeping the previous list");
  const rows = new Map();
  for (const el of elements) {
    const row = fromOsm(el, towns);
    if (row && !rows.has(row.osm)) rows.set(row.osm, row);
  }
  const sorted = [...rows.values()].sort((a, b) => a.town.localeCompare(b.town) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  mkdirSync(OUT.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(OUT, sorted.map((r) => JSON.stringify(r)).join("\n") + (sorted.length ? "\n" : ""));
  const byKind = Object.entries(Object.groupBy(sorted, (r) => r.kind)).map(([k, v]) => `${k} ${v.length}`).join(", ");
  console.log(`osm: ${elements.length} elements, ${sorted.length} places (${byKind}) -> ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
