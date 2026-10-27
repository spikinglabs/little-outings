import { test } from "node:test";
import assert from "node:assert/strict";
import { whereGuesser } from "../src/lib/where-guess.ts";
import { applyEventTally, normalizeEvent, normalizePlace } from "../src/lib/merge.ts";
import { gapsOf } from "../src/lib/gaps.ts";
import { mapLink } from "../src/lib/maps.ts";
import type { Event } from "../src/lib/types.ts";

const towns = [{ name: "Düren", lat: 50.8, lon: 6.48 }];
const museum = normalizePlace("lhm", {
  kind: "museum", name: "Leopold-Hoesch-Museum", address: { town: "Düren", street: "Hoeschplatz 1" },
  geo: { lat: 50.801, lon: 6.481, precision: "exact" }, trust: { level: "verified" },
}, undefined, towns);
const places = new Map([["lhm", museum]]);
const cal = { origin: "cityklub", attribution: "Stadt Düren", source_url: "https://example.org" };
const ev = (id: string, raw: Record<string, unknown>) =>
  normalizeEvent(id, { town: "Düren", start: "2026-10-27", ...cal, ...raw } as any, {}, places, towns)!;

const lib = (n: number) => ev(`lib-${n}`, { title: `Lesung ${n}`, venue: "Stadtbibliothek", geo: { lat: 50.803, lon: 6.482, precision: "exact" } });
const all: Event[] = [lib(1), lib(2), ev("kino", { title: "Film", venue: "Kino", geo: { lat: 50.81, lon: 6.49, precision: "exact" } })];

test("an event without a venue gets the venues its calendar uses at least twice, marked as such", () => {
  // A venue used once ("Kino" here; a cemetery in real life) is no guess for anything else.
  const e = ev("x", { title: "Let's Play" });
  assert.deepEqual(whereGuesser([...all, e], [museum])(e), [{ value: "Stadtbibliothek", at: { lat: 50.803, lon: 6.482 }, usual: true }]);
});

test("a known place named in the title or as the venue comes first, with its street", () => {
  const e = ev("y", { title: "Familientag im Leopold-Hoesch-Museum" });
  assert.deepEqual(whereGuesser([...all, e], [museum])(e)[0], { value: "Leopold-Hoesch-Museum, Hoeschplatz 1", at: { lat: 50.801, lon: 6.481, place: "lhm" } });
  // A named venue rules out the calendar's other venues.
  const v = ev("z", { title: "Lesung", venue: "Stadtbibliothek" });
  assert.deepEqual(whereGuesser([...all, v], [museum])(v).map((a) => a.value), ["Stadtbibliothek"]);
});

test("an event with an exact spot needs no guesses", () => {
  assert.deepEqual(whereGuesser(all, [museum])(all[0]), []);
});

test("an agreed place or picked spot pins the event; agreed words become its address", () => {
  const e = ev("w", { title: "Let's Play" });
  const atPlace = applyEventTally(e, { answers: { where: "Leopold-Hoesch-Museum", whereAt: { lat: 50.8, lon: 6.48, place: "lhm" } } }, places);
  assert.equal(atPlace.place, "lhm");
  assert.equal(atPlace.geo.precision, "exact");
  const atPoint = applyEventTally(e, { answers: { where: "50.80312, 6.48211", whereAt: { lat: 50.80312, lon: 6.48211 } } }, places);
  assert.deepEqual(atPoint.geo, { lat: 50.80312, lon: 6.48211, precision: "exact" });
  assert.equal(atPoint.address, undefined);
  const words = applyEventTally(e, { answers: { where: "Schützenstraße 3" } }, places);
  assert.equal(words.address, "Schützenstraße 3");
  assert.ok(!gapsOf(words).some((g) => g.type === "where"));
  assert.match(mapLink(words)!.google, /Sch%C3%BCtzenstra%C3%9Fe%203/);
  // Answers waiting for a second parent ride along for the page.
  assert.deepEqual(applyEventTally(e, { asks: { where: [{ value: "Kino", count: 1 }] } }).asks, { where: [{ value: "Kino", count: 1 }] });
});

test("a where answer keeps its spot in the inbox issue; other answers can't carry one", async () => {
  const { issueOf } = await import("../functions/api/inbox.ts");
  const r = await issueOf({ kind: "answer", gap: "ev-1:where", answer: "Stadtbibliothek", lat: "50.803101", lon: 6.4821, place: "lhm" }) as { yaml: string };
  assert.match(r.yaml, /lat: 50\.80310\nlon: 6\.48210\nplace: "lhm"/);
  const far = await issueOf({ kind: "answer", gap: "ev-1:where", answer: "x", lat: 10, lon: 10 }) as { yaml: string };
  assert.doesNotMatch(far.yaml, /lat:/);
  const price = await issueOf({ kind: "answer", gap: "ev-1:price", answer: "3 €", lat: 50.8, lon: 6.48 }) as { yaml: string };
  assert.doesNotMatch(price.yaml, /lat:/);
});

test("the address under a tapped spot reads like a sign: name, street and number, town", async () => {
  const { labelOf } = await import("../functions/api/reverse.ts");
  assert.deepEqual(labelOf({ name: "Repair Café", address: { road: "Europaring", house_number: "6", city: "Leverkusen" } }),
    { label: "Repair Café, Europaring 6, Leverkusen", name: "Repair Café" });
  assert.deepEqual(labelOf({ name: "Europaring", address: { road: "Europaring", town: "Leverkusen" } }), { label: "Europaring, Leverkusen" });
  assert.deepEqual(labelOf({}), { label: "" });
});
