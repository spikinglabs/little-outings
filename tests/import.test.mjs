import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromExport } from "../scripts/import-cityklub.mjs";

const rows = readFileSync(new URL("./fixtures/public-events.jsonl", import.meta.url), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));
const ctx = { towns: [{ name: "Köln", lat: 50.938, lon: 6.96 }], today: "2026-10-08" };
const out = rows.map((r) => fromExport(r, ctx)).filter(Boolean);

test("keeps only upcoming, in-person family events in the region", () => {
  assert.deepEqual(out.map((e) => e.id), ["ck-koeln-0001", "ck-koeln-0002"]);
});

test("a recorded point is exact, a town alone is an area", () => {
  assert.deepEqual(out[0].data.geo, { lat: 50.948, lon: 6.92, precision: "exact" });
  assert.deepEqual(out[1].data.geo, { precision: "area" });
});

test("keeps attribution, source link and price text", () => {
  const e = out[0].data;
  assert.equal(e.attribution, "Stadt Köln");
  assert.equal(e.source_url, "https://example.org/a");
  assert.deepEqual(e.price, { free: true, text: "Eintritt frei" });
  assert.equal(e.trust.level, "official");
});

test("unknown fields stay missing so they become quick tasks", () => {
  assert.equal(out[1].data.time, undefined);
  assert.equal(out[1].data.price, undefined);
});

test("reads rows published from the admin site", () => {
  const published = {
    event_id: "cologne-city-events:42", title: "Laternenbasteln", start_date: "2099-11-01", family: true,
    location: { city: "Köln", street: "Venloer Str.", house_number: "1" }, source_id: "museums",
    source_name: "Museen Köln", source_url: "https://example.org/m", venue: "Museum",
  };
  const ev = fromExport(published, ctx);
  assert.equal(ev.id, "ck-cologne-city-events-42");
  assert.equal(ev.data.attribution, "Museen Köln");
  assert.equal(ev.data.source_id, "museums");
  assert.equal(ev.data.venue, "Museum, Venloer Str. 1");
  assert.equal(fromExport({ ...published, family: undefined }, ctx), null);
});
