import { test } from "node:test";
import assert from "node:assert/strict";
import { daysFor, fit, mood, pack, sharedMood, skyIcon, skyWord, type Day } from "../src/lib/weather.ts";
import { orderEvents, orderPlaces } from "../src/lib/order.ts";
import { forecastUrl, toTowns } from "../scripts/fetch-weather.mjs";

const day = (d: string, code: number, max: number, rain: number, min = max - 6): Day => ({ day: d, code, max, min, rain });

test("a day's mood: rain beats cold, then snow, cold, heat and nice", () => {
  assert.equal(mood(day("x", 61, 3, 80)), "rain");
  assert.equal(mood(day("x", 2, 14, 70)), "rain"); // likely rain, even with sun in the code
  assert.equal(mood(day("x", 73, 0, 50)), "snow");
  assert.equal(mood(day("x", 3, 4, 10)), "cold");
  assert.equal(mood(day("x", 0, 31, 0)), "hot");
  assert.equal(mood(day("x", 1, 16, 10)), "nice");
  assert.equal(mood(day("x", 3, 9, 20)), "plain"); // grey and cool: nothing to nudge
  assert.equal(mood(day("x", 51, 14, 29)), "plain"); // a light drizzle, unlikely
  assert.equal(mood(day("x", 53, 14, 51)), "rain");
});

test("weather words and icons in each language", () => {
  assert.equal(skyWord(81, "de"), "Schauer");
  assert.equal(skyWord(0, "en"), "sunny");
  assert.equal(skyWord(3, "zh"), "多云");
  assert.equal(skyIcon(63), "🌧");
});

test("places follow the weather only when every day agrees", () => {
  assert.equal(sharedMood([day("sa", 61, 10, 90), day("so", 3, 4, 10)]), "rain");
  assert.equal(sharedMood([day("sa", 61, 10, 90), day("so", 1, 16, 0)]), "plain");
  assert.equal(sharedMood([day("sa", 1, 16, 0), day("so", 0, 18, 0)]), "nice");
});

test("what suits the mood comes first, unknown in the middle", () => {
  assert.deepEqual([{ indoor: true }, {}, { indoor: false }].map((c) => fit("rain", c)), [0, 1, 2]);
  assert.deepEqual([{ indoor: true }, {}, { indoor: false }].map((c) => fit("nice", c)), [2, 1, 0]);
  assert.equal(fit("hot", { water: true }), 0);
  assert.equal(fit("plain", { indoor: true }), fit("plain", { indoor: false }));
});

test("the build packs past days away and lends a near town its neighbour's forecast", () => {
  const file = { towns: { Köln: [day("2026-10-30", 61, 11.6, 80), day("2026-10-31", 61, 10.4, 90), day("2026-11-01", 1, 14, 5)] } };
  const towns = [{ name: "Köln", lat: 50.938, lon: 6.96 }, { name: "Hürth", lat: 50.87, lon: 6.86 }, { name: "Berlin", lat: 52.52, lon: 13.4 }];
  const p = pack(file, towns, "2026-10-31")!;
  assert.deepEqual(p.towns["Köln"], [[61, 10, 4, 90], [1, 14, 8, 5]]);
  assert.deepEqual(p.towns["Hürth"], p.towns["Köln"]);
  assert.equal(p.towns["Berlin"], undefined); // too far to borrow
  assert.deepEqual(daysFor(p, "Köln", "2026-11-01", "2026-11-01").map((d) => d.max), [14]);
  assert.equal(pack({ towns: {} }, towns, "2026-10-31"), undefined);
});

test("in Mixed, rain-proof events come first within the same part of a rainy day", () => {
  const evs = [
    { id: "fest", start: "2026-10-31", end: "2026-10-31", time: "10:00", roof: false },
    { id: "museum", start: "2026-10-31", end: "2026-10-31", time: "10:30", roof: true },
    { id: "sunday-walk", start: "2026-11-01", end: "2026-11-01", time: "10:00", roof: false },
    { id: "sunday-show", start: "2026-11-01", end: "2026-11-01", time: "11:00", roof: true },
  ];
  const moods = new Map([["2026-10-31", "rain"], ["2026-11-01", "nice"]] as const);
  const out = orderEvents(evs, "mixed", "2026-10-31", "2026-10-26", "seed", (r, d) => fit(moods.get(d as "2026-10-31") ?? "plain", { indoor: r.roof }));
  assert.deepEqual(out.map((r) => r.id), ["museum", "fest", "sunday-walk", "sunday-show"]);
  // Soonest stays a plain sort.
  const plain = orderEvents(evs, "soonest", "2026-10-31", "2026-10-26", "seed", () => 0);
  assert.equal(plain[0].id.startsWith("sunday"), false);
  const pls = orderPlaces([{ id: "a", roof: false }, { id: "b", roof: true }, { id: "c" }], "mixed", "seed", (r) => fit("rain", { indoor: (r as { roof?: boolean }).roof }));
  assert.deepEqual(pls.map((r) => r.id), ["b", "c", "a"]);
});

test("one Open-Meteo request for all towns, read back per town", () => {
  const towns = [{ name: "Köln", lat: 50.9, lon: 6.9 }, { name: "Bonn", lat: 50.7, lon: 7.1 }];
  assert.match(forecastUrl(towns), /latitude=50.9,50.7&longitude=6.9,7.1&daily=weather_code,/);
  const d = (code: number) => ({ daily: { time: ["2026-10-31"], weather_code: [code], temperature_2m_max: [12], temperature_2m_min: [6], precipitation_probability_max: [70] } });
  assert.deepEqual(toTowns(towns, [d(61), d(3)]), {
    Köln: [{ day: "2026-10-31", code: 61, max: 12, min: 6, rain: 70 }],
    Bonn: [{ day: "2026-10-31", code: 3, max: 12, min: 6, rain: 70 }],
  });
  assert.deepEqual(Object.keys(toTowns([towns[0]], d(1))), ["Köln"]); // one town: a single object
});
