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
const KID_MUSEUM = /kinder|kids|jugend|natur|technik|science|spiel|mitmach|zoo|tier|eisenbahn|bahn|bergbau|feuerwehr|odysseum|schokolade|dino|planetar|sternwarte|bauernhof|freilicht|römer|roemer|neanderthal|aquarium/i;
const KID_MUSEUM_TYPE = new Set(["children", "nature", "science", "technology", "railway", "transport", "open_air", "mining", "archaeological"]);
// Animal places besides a zoo: petting zoos, wildlife parks and the many small "Wildgehege".
const ANIMALS = ["petting_zoo", "wildlife_park", "safari_park", "enclosure", "birds", "falconry"];
// Cafés are only family cafés: a play corner tagged in OSM, or a name that says so.
const FAMILY_CAFE = /kinder|spiel|familie|eltern|baby|mama|papa|kids/i;

/** Which family place an OSM object is, or null. Order matters: the most specific tag wins. */
export function kindOf(tags) {
  if (tags.tourism === "zoo" || tags.tourism === "aquarium" || ANIMALS.includes(tags.zoo)) return "zoo";
  if (tags.shop === "farm" || tags.tourism === "farm" || tags.attraction === "farm") return "farm";
  if (tags.leisure === "indoor_play" || tags.leisure === "trampoline_park"
    || (tags.leisure === "playground" && tags.indoor === "yes")) return "indoor";
  if (tags.leisure === "playground") return "playground";
  if (tags.leisure === "water_park" || tags.amenity === "public_bath" || tags.leisure === "swimming_area"
    || (tags.leisure === "sports_centre" && /swimming/.test(tags.sport || ""))) return "pool";
  if (tags.tourism === "museum" && (KID_MUSEUM_TYPE.has(tags.museum) || KID_MUSEUM.test(tags.name || ""))) return "museum";
  if (tags.tourism === "theme_park" || tags.sport === "climbing_adventure" || tags.attraction === "summer_toboggan") return "fun";
  if (tags.amenity === "cafe" && ((tags.kids_area && tags.kids_area !== "no") || FAMILY_CAFE.test(tags.name || ""))) return "cafe";
  // Parks well known enough to have a Wikidata entry, and botanical gardens: worth a trip, unlike every green corner.
  if ((tags.leisure === "park" && tags.wikidata) || (tags.leisure === "garden" && tags["garden:type"] === "botanical")) return "park";
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

/** One small query per tag, with the kind it yields: the public servers answer 504 to one big union. */
export function overpassQueries(towns) {
  // Exact tag values only: a regex or a bare key makes Overpass scan the whole box and answer 504.
  const filters = [
    ["playground", '["leisure"="playground"]["name"]'],
    ["indoor", '["leisure"="indoor_play"]["name"]'], ["indoor", '["leisure"="trampoline_park"]["name"]'],
    ["park", '["leisure"="park"]["name"]["wikidata"]'], ["park", '["leisure"="garden"]["garden:type"="botanical"]["name"]'],
    ["zoo", '["tourism"="zoo"]["name"]'], ["zoo", '["tourism"="aquarium"]["name"]'],
    ...ANIMALS.map((v) => ["zoo", `["zoo"="${v}"]["name"]`]),
    ["farm", '["shop"="farm"]["name"]'], ["farm", '["tourism"="farm"]["name"]'],
    ["pool", '["leisure"="water_park"]["name"]'], ["pool", '["amenity"="public_bath"]["name"]'],
    ["pool", '["leisure"="sports_centre"]["sport"="swimming"]["name"]'], ["pool", '["leisure"="swimming_area"]["name"]'],
    ["museum", '["tourism"="museum"]["name"]'],
    ["cafe", '["amenity"="cafe"]["kids_area"]["name"]'], ["cafe", '["amenity"="cafe"]["name"~"kinder|spiel|famil|eltern|baby|kids",i]'],
    ["fun", '["tourism"="theme_park"]["name"]'], ["fun", '["sport"="climbing_adventure"]["name"]'], ["fun", '["attraction"="summer_toboggan"]["name"]'],
  ];
  const box = bbox(towns).join(",");
  return filters.map(([kind, f]) => ({ kind, query: `[out:json][timeout:90][bbox:${box}];nwr${f};out center tags;` }));
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
  if (kind === "cafe" && tags.kids_area && tags.kids_area !== "no") facilities.push(tags.kids_area === "outdoor" ? "playground" : "indoor_play");
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
    indoor: kind === "indoor" || tags.indoor === "yes" || kind === "museum" ? true : undefined,
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
  const failed = new Set();
  for (const { kind, query } of overpassQueries(towns)) {
    try { elements.push(...(await overpass(query))); } catch (e) { failed.add(kind); console.error(e.message); }
    await sleep(2000);
  }
  if (!elements.length) throw new Error("Overpass returned no places; keeping the previous list");
  const rows = new Map();
  // A kind with a failed query keeps last week's rows, so its place pages don't disappear; what
  // its other queries found this week is added (a kind has several queries, e.g. zoo and Wildgehege).
  const previous = existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  for (const row of previous) if (failed.has(row.kind)) rows.set(row.osm, row);
  for (const el of elements) {
    const row = fromOsm(el, towns);
    if (row) rows.set(row.osm, row);
  }
  const sorted = [...rows.values()].sort((a, b) => a.town.localeCompare(b.town) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  mkdirSync(OUT.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(OUT, sorted.map((r) => JSON.stringify(r)).join("\n") + (sorted.length ? "\n" : ""));
  const byKind = Object.entries(Object.groupBy(sorted, (r) => r.kind)).map(([k, v]) => `${k} ${v.length}`).join(", ");
  const kept = failed.size ? `; kept last week's ${[...failed].join(", ")} (query failed)` : "";
  console.log(`osm: ${elements.length} elements, ${sorted.length} places (${byKind})${kept} -> ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
