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

test("an event without a point asks for its street, venue, then district", async () => {
  const { pinQueries, pinOf } = await import("../scripts/import-cityklub.mjs");
  const berlin = { name: "Berlin", lat: 52.52, lon: 13.405 };
  const near = [52.52, 13.405, 30];
  const ev = fromExport({
    event_id: "b1", title: "Kindertheater", start_date: "2099-11-01", family: true, source_url: "https://example.org/b",
    venue: "ATZE Musiktheater", location: { city: "Berlin", district: "Mitte", street: "Luxemburger Straße 20", postal_code: "13353" },
  }, { towns: [berlin], today: "2026-10-08" });
  assert.deepEqual(ev.data.geo, { precision: "area" });
  assert.deepEqual(ev.ask, [
    { q: "Luxemburger Straße 20, 13353 Berlin", near },
    { q: "ATZE Musiktheater, Berlin", near, precision: "venue" },
    { q: "Mitte, Berlin", near, precision: "area" },
  ]);
  assert.deepEqual(pinQueries({ city: "Berlin" }, berlin), []);
  // The first query that finds something wins; a house number makes it exact.
  const hits = { "ATZE Musiktheater, Berlin": { lat: "52.5422", lon: "13.3502", address: {} } };
  assert.deepEqual(await pinOf(ev.ask, async (q) => hits[q] ?? null), { lat: 52.5422, lon: 13.3502, precision: "venue" });
  assert.deepEqual(await pinOf(ev.ask, async () => ({ lat: "52.5", lon: "13.3", address: { house_number: "20" } })),
    { lat: 52.5, lon: 13.3, precision: "exact" });
  assert.equal(await pinOf(ev.ask, async () => null), null);
});

test("warns about towns whose events pile up on the town centre", async () => {
  const { crowdedTowns } = await import("../scripts/import-cityklub.mjs");
  const lines = crowdedTowns(new Map([["Berlin", [1503, 1503]], ["Köln", [900, 30]], ["Düren", [24, 24]]]));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^::warning .*1503 of 1503 events in Berlin/);
  assert.match(lines[1], /24 of 24 events in Düren/);
});

test("a venue's hand-kept street and its short name are asked for too", () => {
  const aachen = { name: "Aachen", lat: 50.776, lon: 6.084 };
  const near = [50.776, 6.084, 30];
  const row = (venue) => ({ event_id: venue, title: "Vorlesen", start_date: "2099-11-01", family: true, source_url: "https://example.org/a", venue, location: { city: "Aachen" } });
  const addresses = { Aachen: { Stadbibliothek: "Couvenstraße 15" } };
  assert.deepEqual(fromExport(row("Stadbibliothek"), { towns: [aachen], today: "2026-10-08", addresses }).ask, [
    { q: "Couvenstraße 15, Aachen", near },
    { q: "Stadbibliothek, Aachen", near, precision: "venue" },
  ]);
  assert.deepEqual(fromExport(row("Stadtbibliothek – Kinderbibliothek"), { towns: [aachen], today: "2026-10-08" }).ask, [
    { q: "Stadtbibliothek – Kinderbibliothek, Aachen", near, precision: "venue" },
    { q: "Stadtbibliothek, Aachen", near, precision: "venue" },
  ]);
});

test("events starting after the horizon wait for a later build", () => {
  const row = { event_id: "far", title: "Weihnachtsmarkt", start_date: "2027-12-01", family: true, source_url: "https://example.org/w", location: { city: "Köln" } };
  assert.equal(fromExport(row, { ...ctx, until: "2027-04-08" }), null);
  assert.ok(fromExport(row, { ...ctx, until: "2028-01-01" }));
  assert.ok(fromExport(row, ctx));
});

test("events are imported for the same two weeks Discover shows", async () => {
  const { lastDay, DAYS_AHEAD } = await import("../src/lib/horizon.ts");
  assert.equal(DAYS_AHEAD, 14);
  assert.equal(lastDay("2026-10-14"), "2026-10-27"); // today plus 13 days, as in "next two weeks"
  assert.equal(lastDay("2026-03-20"), "2026-04-02"); // across the change to summer time
});
