import { test } from "node:test";
import assert from "node:assert/strict";
import { gapsOf, tasksOf } from "../src/lib/gaps.ts";
import { normalizeEvent, normalizePlace, resolveGeo } from "../src/lib/merge.ts";

const towns = [{ name: "Velbert", lat: 51.34, lon: 7.043 }];
const farm = normalizePlace("hof", {
  kind: "farm", name: "Hof", address: { town: "Velbert" }, geo: { lat: 51.3, lon: 7.1, precision: "exact" },
  facilities: { toilets: { status: "yes", confirmed: 3 } }, trust: { level: "verified" },
}, undefined, towns);
const places = new Map([["hof", farm]]);

test("an event without time, price and location has those gaps", () => {
  const e = normalizeEvent("e1", { title: "Fest", town: "Velbert", start: new Date("2026-10-11") }, {}, places, towns)!;
  assert.equal(e.geo.precision, "area");
  assert.deepEqual(gapsOf(e).map((g) => g.type), ["where", "time", "price", "still"]);
});

test("an event at a place inherits its exact location", () => {
  const e = normalizeEvent("e2", { title: "Hoffest", place: "hof", start: "2026-10-11", time: "11:00", price: { free: true }, trust: { level: "verified" } }, {}, places, towns)!;
  assert.equal(e.geo.precision, "exact");
  assert.equal(e.town, "Velbert");
  assert.deepEqual(gapsOf(e), []);
});

test("overrides win over imported data and answers", () => {
  const e = normalizeEvent("e3", { title: "A", town: "Velbert", start: "2026-10-11", time: "10:00" },
    { answer: { fields: { time: "11:00" } }, override: { time: "12:00" } }, places, towns)!;
  assert.equal(e.time, "12:00");
});

test("hidden overrides remove an imported event", () => {
  assert.equal(normalizeEvent("e4", { title: "A", town: "Velbert", start: "2026-10-11" }, { override: { hidden: true } }, places, towns), null);
});

test("unknown facilities become at most two questions", () => {
  const fac = gapsOf(farm).filter((g) => g.type === "fac").map((g) => g.feature);
  assert.deepEqual(fac, ["changing_table", "playground"]);
});

test("a town not in the region and no point is unknown", () => {
  assert.deepEqual(resolveGeo(undefined, "Nowhere", towns), { precision: "unknown" });
});

test("tasks: soon events first, places after, past events never", () => {
  const soon = normalizeEvent("soon", { title: "S", town: "Velbert", start: "2026-10-09" }, {}, places, towns)!;
  const past = normalizeEvent("past", { title: "P", town: "Velbert", start: "2026-10-01" }, {}, places, towns)!;
  const ids = tasksOf([past, soon], [farm], "2026-10-08").map((t) => t.id);
  assert.deepEqual(ids, ["soon", "hof"]);
});

test("a playground asks about playground things, not high chairs", async () => {
  const { featuresFor, askOnPage } = await import("../src/lib/features.ts");
  assert.ok(featuresFor("playground").includes("sandpit"));
  assert.ok(!featuresFor("playground").includes("highchairs"));
  assert.ok(featuresFor("cafe").includes("highchairs"));
  assert.deepEqual(askOnPage("playground"), featuresFor("playground"));
});
