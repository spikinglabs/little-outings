import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { placeFromOsm, farmsFromEvents } from "../scripts/import-places.mjs";

// Rows as spikinglabs/cityklub-event-data writes them to the places bucket (cityklub places).
const row = (id, extra = {}) => ({ osm: `node/${id}`, kind: "playground", name: `Spielplatz ${id}`, town: "Velbert", lat: 51.341, lon: 7.045, free: true, facilities: [], ...extra });

test("placeFromOsm matches the place schema shape", () => {
  const p = placeFromOsm(row(5, { kind: "zoo", name: "Grüner Zoo", hours: "Mo-Su 09:00-18:00", free: undefined, facilities: ["animals"] }));
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
  const known = [placeFromOsm(row(6, { kind: "farm", name: "Hofladen Gut Hixholz" }))];
  assert.equal(farmsFromEvents([ev("Gut Hixholz")], known).length, 0);
});

test("the importer writes, hides and prunes place files", () => {
  const dir = mkdtempSync(join(tmpdir(), "places-"));
  const content = join(dir, "content");
  mkdirSync(join(content, "places", "imported"), { recursive: true });
  writeFileSync(join(content, "places", "imported", "osm-node-999.yaml"), "kind: farm\n");
  writeFileSync(join(content, "hidden-places.yaml"), "- osm-node-8\n");
  const rows = [row(7), row(8)];
  writeFileSync(join(dir, "osm.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n"));
  writeFileSync(join(dir, "outings.jsonl"), JSON.stringify(ev("Gut Hixholz")) + "\n");
  const run = (env) => execFileSync("node", ["scripts/import-places.mjs"], { env: { ...process.env, CONTENT_DIR: content, OSM_FILE: join(dir, "osm.jsonl"), OUTINGS_FILE: join(dir, "outings.jsonl"), PLACES_EXPORT: "", ...env } }).toString();
  assert.match(run(), /\(the snapshot\)/);
  const files = readdirSync(join(content, "places", "imported")).sort();
  assert.deepEqual(files, ["farm-velbert-gut-hixholz.yaml", "osm-node-7.yaml"]);
  assert.match(readFileSync(join(content, "places", "imported", "osm-node-7.yaml"), "utf8"), /^# Generated/);

  // The weekly file from the places bucket wins over the snapshot; a broken one falls back to it.
  writeFileSync(join(dir, "export.jsonl"), JSON.stringify(row(9)) + "\n");
  assert.match(run({ PLACES_EXPORT: join(dir, "export.jsonl") }), /\(the places bucket\)/);
  assert.ok(readdirSync(join(content, "places", "imported")).includes("osm-node-9.yaml"));
  assert.match(run({ PLACES_EXPORT: join(dir, "missing.jsonl") }), /::warning title=Places::[\s\S]*\(the snapshot\)/);
});

test("a place without an address gets the nearest road and its district", () => {
  const nearby = { road: "Volksgartenstraße", district: "Neustadt-Süd", postcode: "50677" };
  const p = placeFromOsm(row(7, { nearby }));
  assert.deepEqual(p.data.address, { near: "Volksgartenstraße", district: "Neustadt-Süd", postcode: "50677", town: "Velbert" });
  const tagged = placeFromOsm(row(8, { street: "Weg 1", nearby }));
  assert.equal(tagged.data.address.street, "Weg 1");
  assert.equal(tagged.data.address.near, undefined, "a real street address wins");
});

