// Imported places → content/places/imported/<id>.yaml, run before every build.
//
//   PLACES_EXPORT           OpenStreetMap places with their nearest street, a URL (or a path): the public
//                           places bucket, refreshed weekly by spikinglabs/cityklub-event-data (cityklub places)
//   data/places-osm.jsonl   the last snapshot, used when PLACES_EXPORT is unset or can't be read
//   data/outings.jsonl      farms that run events (farm event sources) become farm places too
//   content/hidden-places.yaml   ids that must never appear (a list), e.g. a closed playground
// Files here are rewritten every run; hand-written places live in content/places/ directly.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dump, load } from "js-yaml";

const FARM_SOURCES = new Set(["landservice-nrw-farm-events", "gut-hixholz-farm-events"]);
const OSM = { level: "community", source: "OpenStreetMap" };

const fold = (s) => String(s ?? "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
  .replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "");
const slug = (s) => fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const parse = (text) => text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const jsonl = (path) => (existsSync(path) ? parse(readFileSync(path, "utf8")) : []);

/** The weekly places file from the public bucket; null (with a warning) when it can't be read. */
async function download(source) {
  try {
    if (!/^https?:/.test(source)) return parse(readFileSync(source, "utf8"));
    const res = await fetch(source, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    const rows = parse(await res.text());
    if (!rows.length) throw new Error("is empty");
    return rows;
  } catch (e) {
    console.log(`::warning title=Places::PLACES_EXPORT ${e.message}; using the snapshot in the repository`);
    return null;
  }
}

/** One OSM row → one place in the site's place schema. nearby: its nearest road and district, if known. */
export function placeFromOsm(row) {
  const geo = row.nearby ?? {};
  const data = {
    kind: row.kind,
    name: row.name,
    // No address tags (most playgrounds): the nearest road stands in, shown as "near …".
    address: { street: row.street, near: row.street ? undefined : geo.road, district: geo.district, postcode: row.postcode ?? geo.postcode, town: row.town },
    geo: { lat: row.lat, lon: row.lon, precision: "exact" },
    hours: row.hours,
    indoor: row.indoor,
    free: row.free,
    facilities: Object.fromEntries((row.facilities || []).map((f) => [f, { status: "yes", confirmed: 0 }])),
    trust: OSM,
    website: row.website,
  };
  return { id: `osm-${row.osm.replace("/", "-")}`, data: clean(data) };
}

/**
 * Farms from farm event sources: one place per venue and town, named by the shortest form
 * of the venue ("Gut Hixholz" over "Greshake, Gut Hixholz - Lern- und Erlebnisbauernhof").
 * Skipped when an OSM farm of a similar name already exists in that town.
 */
export function farmsFromEvents(rows, osmPlaces) {
  const known = osmPlaces.filter((p) => p.data.kind === "farm").map((p) => [fold(p.data.name), p.data.address.town]);
  const farms = new Map();
  for (const r of rows) {
    if (!FARM_SOURCES.has(r.source_id) || !r.venue || !r.location?.city) continue;
    const town = r.location.city;
    const name = r.venue.trim();
    const group = [...farms.values()].find((f) => f.town === town && (fold(f.name).includes(fold(name)) || fold(name).includes(fold(f.name))));
    const point = typeof r.location.latitude === "number" ? { lat: r.location.latitude, lon: r.location.longitude, precision: "exact" } : null;
    if (group) {
      if (name.length < group.name.length) group.name = name;
      group.point ??= point;
      group.street ??= [r.location.street, r.location.house_number].filter(Boolean).join(" ") || undefined;
    } else {
      farms.set(`${town}|${name}`, { name, town, point, street: [r.location.street, r.location.house_number].filter(Boolean).join(" ") || undefined, postcode: r.location.postal_code, source: r.source_name || r.source_id });
    }
  }
  return [...farms.values()]
    .filter((f) => !known.some(([n, t]) => t === f.town && (n.includes(fold(f.name)) || fold(f.name).includes(n))))
    .map((f) => ({
      id: `farm-${slug(`${f.town}-${f.name}`)}`,
      data: clean({
        kind: "farm",
        name: f.name,
        address: { street: f.street, postcode: f.postcode, town: f.town },
        geo: f.point ?? { precision: "area" },
        facilities: { animals: { status: "yes", confirmed: 0 } },
        trust: { level: "official", source: f.source },
      }),
    }));
}

function clean(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === "") delete obj[k];
    else if (v && typeof v === "object" && !Array.isArray(v)) clean(v);
  }
  return obj;
}

async function main() {
  const root = process.env.CONTENT_DIR || "content";
  const hiddenFile = join(root, "hidden-places.yaml");
  const hidden = new Set(existsSync(hiddenFile) ? load(readFileSync(hiddenFile, "utf8")) || [] : []);
  const exported = process.env.PLACES_EXPORT ? await download(process.env.PLACES_EXPORT) : null;
  const from = exported ? "the places bucket" : "the snapshot";
  const osm = (exported ?? jsonl(process.env.OSM_FILE || "data/places-osm.jsonl")).map(placeFromOsm);
  const farms = farmsFromEvents(jsonl(process.env.OUTINGS_FILE || "data/outings.jsonl"), osm);
  const out = join(root, "places", "imported");
  mkdirSync(out, { recursive: true });
  const keep = new Set();
  for (const place of [...osm, ...farms]) {
    if (hidden.has(place.id) || keep.has(place.id)) continue;
    keep.add(place.id);
    writeFileSync(join(out, `${place.id}.yaml`), "# Generated by scripts/import-places.mjs. Do not edit; hide it in content/hidden-places.yaml.\n" + dump(place.data, { lineWidth: 120 }));
  }
  for (const f of readdirSync(out)) if (f.endsWith(".yaml") && !keep.has(f.slice(0, -5))) unlinkSync(join(out, f));
  console.log(`places: ${osm.length} from OpenStreetMap (${from}), ${farms.length} farms from events, ${hidden.size} hidden -> ${keep.size} written`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
