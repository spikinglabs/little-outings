import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { kindOf, fromOsm, overpassQueries, bbox } from "../scripts/fetch-osm-places.mjs";
import { placeFromOsm, farmsFromEvents } from "../scripts/import-places.mjs";

const towns = [{ name: "Velbert", lat: 51.34, lon: 7.043 }, { name: "Wuppertal", lat: 51.256, lon: 7.15 }];
const osm = (id, tags, lat = 51.341, lon = 7.045) => ({ type: "node", id, lat, lon, tags });

test("kindOf keeps family places and drops the rest", () => {
  assert.equal(kindOf({ tourism: "zoo" }), "zoo");
  assert.equal(kindOf({ shop: "farm" }), "farm");
  assert.equal(kindOf({ leisure: "playground" }), "playground");
  assert.equal(kindOf({ leisure: "sports_centre", sport: "swimming;fitness" }), "pool");
  assert.equal(kindOf({ tourism: "museum", name: "Kindermuseum" }), "museum");
  assert.equal(kindOf({ tourism: "museum", name: "Von der Heydt-Museum" }), null);
  assert.equal(kindOf({ amenity: "cafe" }), null);
  assert.equal(kindOf({ amenity: "cafe", kids_area: "indoor" }), "cafe");
  assert.equal(kindOf({ amenity: "cafe", name: "Spielcafé Wirbelwind" }), "cafe");
  assert.equal(kindOf({ leisure: "indoor_play" }), "indoor");
  assert.equal(kindOf({ leisure: "trampoline_park" }), "indoor");
  assert.equal(kindOf({ zoo: "enclosure", name: "Wildgehege" }), "zoo");
  assert.equal(kindOf({ tourism: "aquarium" }), "zoo");
  assert.equal(kindOf({ leisure: "swimming_area" }), "pool");
  assert.equal(kindOf({ tourism: "museum", museum: "technology", name: "LVR-Industriemuseum" }), "museum");
  assert.equal(kindOf({ tourism: "theme_park" }), "fun");
  assert.equal(kindOf({ sport: "climbing_adventure" }), "fun");
  assert.equal(kindOf({ leisure: "park", wikidata: "Q1" }), "park");
  assert.equal(kindOf({ leisure: "park" }), null, "not every green corner");
});

test("fromOsm picks the nearest town, facilities and a safe website", () => {
  const row = fromOsm(osm(1, { shop: "farm", name: "Hofladen Sonne", changing_table: "yes", website: "javascript:alert(1)", "addr:street": "Weg", "addr:housenumber": "3" }), towns);
  assert.equal(row.town, "Velbert");
  assert.equal(row.street, "Weg 3");
  assert.deepEqual(row.facilities, ["changing_table", "animals", "farm_shop"]);
  assert.equal(row.website, undefined);
  assert.equal(fromOsm(osm(2, { leisure: "playground" }), towns), null, "no name");
  assert.equal(fromOsm(osm(3, { leisure: "playground", name: "Far" }, 52.5, 13.4), towns), null, "outside the region");
  assert.equal(fromOsm({ type: "way", id: 4, center: { lat: 51.257, lon: 7.151 }, tags: { leisure: "playground", name: "Spielplatz Hardt" } }, towns).free, true);
});

test("the Overpass query covers every town plus the radius in one box", () => {
  const [s, w, n, e] = bbox(towns);
  assert.ok(s < 51.256 - 0.05 && n > 51.34 + 0.05 && w < 7.043 - 0.08 && e > 7.15 + 0.08);
  const qs = overpassQueries(towns);
  assert.equal(qs.length, 25);
  assert.ok(qs.every((q) => !/"zoo"~/.test(q.query)), "no regex on the zoo key: Overpass answers 504");
  assert.equal(qs[0].kind, "playground");
  assert.match(qs[0].query, /^\[out:json\]\[timeout:90\]\[bbox:[\d.,]+\];nwr\["leisure"="playground"\]\["name"\];out center tags;$/);
});

test("placeFromOsm matches the place schema shape", () => {
  const p = placeFromOsm(fromOsm(osm(5, { tourism: "zoo", name: "Grüner Zoo", opening_hours: "Mo-Su 09:00-18:00" }), towns));
  assert.equal(p.id, "osm-node-5");
  assert.deepEqual(p.data.geo, { lat: 51.341, lon: 7.045, precision: "exact" });
  assert.deepEqual(p.data.facilities, { animals: { status: "yes", confirmed: 0 } });
  assert.deepEqual(p.data.trust, { level: "community", source: "OpenStreetMap" });
  assert.equal(p.data.website, undefined, "no OpenStreetMap link stands in for a website");
  assert.equal(p.data.address.street, undefined);
});

const ev = (venue, extra = {}) => ({ source_id: "gut-hixholz-farm-events", source_name: "Gut Hixholz farm events", venue, location: { city: "Velbert", street: "Im Hau 7", postal_code: "42551" }, ...extra });

test("event farms become one place per farm, under the shortest name", () => {
  const farms = farmsFromEvents([
    ev("Greshake, Gut Hixholz - Lern- und Erlebnisbauernhof"), ev("Gut Hixholz"), ev("Gut Hixholz"),
    { ...ev("Stadtbibliothek"), source_id: "library-events" },
  ], []);
  assert.equal(farms.length, 1);
  assert.equal(farms[0].id, "farm-velbert-gut-hixholz");
  assert.equal(farms[0].data.name, "Gut Hixholz");
  assert.equal(farms[0].data.address.street, "Im Hau 7");
  assert.equal(farms[0].data.trust.level, "official");
});

test("event farms already in OpenStreetMap are not doubled", () => {
  const known = [placeFromOsm(fromOsm(osm(6, { shop: "farm", name: "Hofladen Gut Hixholz" }), towns))];
  assert.equal(farmsFromEvents([ev("Gut Hixholz")], known).length, 0);
});

test("the importer writes, hides and prunes place files", () => {
  const dir = mkdtempSync(join(tmpdir(), "places-"));
  const content = join(dir, "content");
  mkdirSync(join(content, "places", "imported"), { recursive: true });
  writeFileSync(join(content, "places", "imported", "osm-node-999.yaml"), "kind: farm\n");
  writeFileSync(join(content, "hidden-places.yaml"), "- osm-node-8\n");
  const rows = [fromOsm(osm(7, { leisure: "playground", name: "Spielplatz Nord" }), towns), fromOsm(osm(8, { leisure: "playground", name: "Closed" }), towns)];
  writeFileSync(join(dir, "osm.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n"));
  writeFileSync(join(dir, "outings.jsonl"), JSON.stringify(ev("Gut Hixholz")) + "\n");
  execFileSync("node", ["scripts/import-places.mjs"], { env: { ...process.env, CONTENT_DIR: content, OSM_FILE: join(dir, "osm.jsonl"), OUTINGS_FILE: join(dir, "outings.jsonl") } });
  const files = readdirSync(join(content, "places", "imported")).sort();
  assert.deepEqual(files, ["farm-velbert-gut-hixholz.yaml", "osm-node-7.yaml"]);
  assert.match(readFileSync(join(content, "places", "imported", "osm-node-7.yaml"), "utf8"), /^# Generated/);
});
