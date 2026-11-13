import { test } from "node:test";
import assert from "node:assert/strict";
import { zooParts } from "../src/lib/zoo-parts.ts";

test("enclosures next to a zoo go, the zoo and a lone Wildgehege stay", () => {
  const p = (id: string, name: string, lat: number, lon: number, kind = "zoo") => ({ id, kind, name, geo: { lat, lon } });
  const out = zooParts([
    p("zoo", "Kölner Zoo", 50.958, 6.975),
    p("gorilla", "Gorilla", 50.96, 6.976),
    p("hirsch", "Hirschgehege", 50.9, 7.1),
    p("pg", "Spielplatz am Zoo", 50.959, 6.975, "playground"),
  ]);
  assert.deepEqual([...out], ["gorilla"]);
});
