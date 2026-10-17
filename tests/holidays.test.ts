import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { holidayFor, townStates } from "../src/lib/holidays.ts";
import { toPeriods } from "../scripts/fetch-holidays.mjs";

const periods = [
  { start: "2026-07-20", end: "2026-09-01", name: "Sommerferien" },
  { start: "2026-10-17", end: "2026-10-31", name: "Herbstferien" },
  { start: "2026-12-23", end: "2027-01-06", name: "Weihnachtsferien" },
];

test("holidays that are on show from today to their end, clipped to the listed days", () => {
  assert.deepEqual(holidayFor(periods, "2026-10-20", "2026-11-02"), { ...periods[1], from: "2026-10-20", to: "2026-10-31" });
  assert.deepEqual(holidayFor(periods, "2026-10-10", "2026-10-23"), { ...periods[1], from: "2026-10-17", to: "2026-10-23" });
  assert.equal(holidayFor(periods, "2026-11-01", "2026-11-14"), null);
  assert.equal(holidayFor(undefined, "2026-10-20", "2026-11-02"), null);
});

test("towns take their own state, or the nearest one's within about 100 km", () => {
  const states = townStates([
    { name: "Köln", lat: 50.94, lon: 6.96, state: "NW" },
    { name: "Berlin", lat: 52.52, lon: 13.405, state: "BE" },
    { name: "Merzenich", lat: 50.83, lon: 6.53 },
    { name: "Potsdam", lat: 52.39, lon: 13.06 },
    { name: "Nürnberg", lat: 49.45, lon: 11.08 },
  ]);
  assert.deepEqual(states, { Köln: "NW", Berlin: "BE", Merzenich: "NW", Potsdam: "BE" });
});

test("only real holidays of three days or more are kept", () => {
  const row = (start: string, endDate: string, text: string) => ({ startDate: start, endDate, name: [{ language: "DE", text }] });
  assert.deepEqual(toPeriods([
    row("2026-10-17", "2026-10-31", "Herbstferien"),
    row("2026-05-26", "2026-05-26", "Pfingstferien"),
    row("2026-11-18", "2026-11-18", "Buß- und Bettag"),
    row("2026-03-30", "2026-04-11", "Osterferien"),
  ]), [
    { start: "2026-03-30", end: "2026-04-11", name: "Osterferien" },
    { start: "2026-10-17", end: "2026-10-31", name: "Herbstferien" },
  ]);
});

test("every holiday name in the data has a label in each language", () => {
  const data = JSON.parse(readFileSync("data/school-holidays.json", "utf8")) as { states: Record<string, { name: string }[]> };
  const names = new Set(Object.values(data.states).flat().map((p) => p.name));
  for (const lang of ["de", "en", "zh"]) {
    const yaml = readFileSync(`i18n/${lang}.yaml`, "utf8");
    for (const n of names) assert.match(yaml, new RegExp(`holidayIn: \\{[^}]*${n}:`), `${lang} ${n}`);
  }
});
