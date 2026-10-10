import { test } from "node:test";
import assert from "node:assert/strict";
import { queryOf, geoLine, withGeo } from "../scripts/geocode-places.mjs";
import { splitStreet } from "../src/lib/merge.ts";

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
  assert.deepEqual(splitStreet(undefined), { street: undefined, postcode: undefined });
});
