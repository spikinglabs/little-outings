import { test } from "node:test";
import assert from "node:assert/strict";
import { isMartin, martinSeason } from "../src/lib/martin.ts";

test("St. Martin walks are recognised by their title", () => {
  for (const title of ["Martinszug: Kita Sonnenschein", "Martinszug Pennenfeld", "Laternenumzug Berne", "Ökumenische Martinsfeier mit Lichterzug",
    "St. Martin: Gottesdienst mit Laternenumzug", "Sankt-Martins-Umzug des Immanuel-Kindergartens", "Laternelaufen", "Laternenbasteln", "Schlebuscher Martinsmarkt"])
    assert.ok(isMartin(title), title);
  for (const title of ["Martin Pfeiffer - Mitmachkonzert", "125 Jahre Martin-Luther-Kirche", "Die Geistergeschichte der Pfingstrosen-Laterne", "Rheinaue parkrun"])
    assert.ok(!isMartin(title), title);
});

test("the St. Martin chip shows from 25 October to 15 November", () => {
  assert.equal(martinSeason("2026-10-24"), false);
  assert.equal(martinSeason("2026-10-25"), true);
  assert.equal(martinSeason("2026-11-11"), true);
  assert.equal(martinSeason("2026-11-15"), true);
  assert.equal(martinSeason("2026-11-16"), false);
});
