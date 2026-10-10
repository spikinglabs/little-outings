import { test } from "node:test";
import assert from "node:assert/strict";
import { queryOf, geoLine, withGeo, eventQueries } from "../scripts/geocode-places.mjs";
import { canonicalTown, splitStreet, townsFromPlaces } from "../src/lib/merge.ts";

test("queryOf asks for the street with its town, once", () => {
  assert.equal(queryOf({ street: "Steinpfahl 4a, 52399 Merzenich", town: "Merzenich" }), "Steinpfahl 4a, 52399 Merzenich");
  assert.equal(queryOf({ street: "Mozartstraße 39, 50674 Köln", town: "Cologne" }), "Mozartstraße 39, 50674 Köln, Cologne");
  assert.equal(queryOf({ street: "Markt 1", postcode: "52349", town: "Düren" }), "Markt 1, 52349 Düren");
  assert.equal(queryOf({ town: "Düren" }), null);
});

test("geoLine is exact only with a house number", () => {
  assert.equal(geoLine({ lat: "50.83", lon: "6.53", address: { house_number: "4a" } }), "geo: { lat: 50.830000, lon: 6.530000, precision: exact }");
  assert.match(geoLine({ lat: "50.83", lon: "6.53", address: {} }), /precision: venue/);
  assert.equal(geoLine(null), null);
});

test("withGeo puts the point under the address", () => {
  const text = "kind: playground\nname: \"X\"\naddress: { town: \"Y\" }\ntrust: { level: community }\n";
  assert.equal(withGeo(text, "geo: { lat: 1, lon: 2 }"),
    "kind: playground\nname: \"X\"\naddress: { town: \"Y\" }\ngeo: { lat: 1, lon: 2 }\ntrust: { level: community }\n");
});

test("splitStreet moves a typed postcode and town out of the street", () => {
  assert.deepEqual(splitStreet("Steinpfahl 4a, 52399 Merzenich"), { street: "Steinpfahl 4a", postcode: "52399" });
  assert.deepEqual(splitStreet("Markt 1"), { street: "Markt 1", postcode: undefined });
  assert.deepEqual(splitStreet("Markt 1, 52349 Düren", "52351"), { street: "Markt 1", postcode: "52351" });
  assert.deepEqual(splitStreet("Gaiaboulevard 1, 6468 PH Kerkrade, Netherlands"), { street: "Gaiaboulevard 1", postcode: "6468 PH" });
  assert.deepEqual(splitStreet("Rotenberg 1, 4700 Eupen"), { street: "Rotenberg 1", postcode: "4700" });
  assert.deepEqual(splitStreet("Markt 1, Netherlands"), { street: "Markt 1, Netherlands", postcode: undefined });
  assert.deepEqual(splitStreet(undefined), { street: undefined, postcode: undefined });
});

test("canonicalTown maps a typed name to the site's town", () => {
  const towns = [{ name: "Köln", lat: 50.9, lon: 6.9, en: "Cologne", zh: "科隆" }];
  assert.equal(canonicalTown("Cologne", towns), "Köln");
  assert.equal(canonicalTown("köln", towns), "Köln");
  assert.equal(canonicalTown("Merzenich", towns), "Merzenich");
});

test("townsFromPlaces adds a pinned place's town the region lacks, once", () => {
  const towns = [{ name: "Düren", lat: 50.8, lon: 6.48 }];
  const place = (town, geo) => ({ town, geo });
  assert.deepEqual(townsFromPlaces([
    place("Merzenich", { lat: 50.83, lon: 6.53, precision: "exact" }),
    place("Merzenich", { lat: 50.84, lon: 6.54, precision: "exact" }),
    place("Düren", { lat: 50.8, lon: 6.48, precision: "exact" }),
    place("Niederzier", { lat: 50.88, lon: 6.47, precision: "area" }),
    place("Kreuzau", { precision: "unknown" }),
  ], towns), [{ name: "Merzenich", lat: 50.83, lon: 6.53 }]);
});

test("eventQueries asks for the venue in its town, then the town", () => {
  assert.deepEqual(eventQueries({ venue: "Bürgerhalle Koslar", town: "Jülich-Koslar" }), [
    { q: "Bürgerhalle Koslar, Jülich-Koslar", precision: "venue" },
    { q: "Jülich-Koslar", precision: "area" },
  ]);
  assert.deepEqual(eventQueries({ town: "Merzenich" }), [{ q: "Merzenich", precision: "area" }]);
  assert.deepEqual(eventQueries({ venue: "Pfarrheim" }), []);
  assert.match(geoLine({ lat: "50.9", lon: "6.4", address: { house_number: "1" } }, "area"), /precision: area/);
});
