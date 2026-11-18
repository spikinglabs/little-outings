import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { adultsOnly, notForWeekendPicks } from "../src/lib/adults-only.ts";

test("adultsOnly: an age limit of 14 or more, or a spa, sauna or hammam by name", () => {
  assert.ok(adultsOnly({ name: "Therme", min_age: 16 }));
  assert.ok(adultsOnly({ name: "Therme", min_age: "14" }));
  assert.ok(!adultsOnly({ name: "Carolus Thermen", min_age: 6 }));
  for (const name of ["Sultan Hamam", "Le Spa München", "Hamam – Wellness & Spa", "Saunapark Nord"]) assert.ok(adultsOnly({ name }), name);
  // A bath with a sauna is a family bath; "Spandau" is not a spa.
  for (const name of ["Aquana Sauna & Freizeitbad", "Calypso Bade- & Saunawelt", "Familienbad & Sauna Heepen", "Spielplatz Spandau"]) assert.ok(!adultsOnly({ name }), name);
});

test("notForWeekendPicks: any Therme or sauna too, though the site may still list it", () => {
  assert.ok(notForWeekendPicks({ name: "Titus Thermen" }));
  assert.ok(notForWeekendPicks({ name: "Aquana Sauna & Freizeitbad" }));
  assert.ok(!notForWeekendPicks({ name: "Oase Freizeitbad" }));
  assert.ok(!notForWeekendPicks({ name: "Grugapark" }));
});

test("Grugapark Therme is hidden for good", () => {
  const hidden = load(readFileSync("content/hidden-places.yaml", "utf8")) as string[];
  assert.ok(hidden.includes("osm-node-469326100"));
});
