import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDecisions, publishRows, rowState, sortKey } from "../admin/public/apply.js";
import { describe, parseAnswers, prune, sortItems, toSort } from "../scripts/sort-events.mjs";

const row = (id, title, extra = {}) => ({
  event_id: id, title, venue: "Haus der Familie", start_date: "2026-11-01", source_id: "bonn-city-events",
  source_name: "Stadt Bonn", cleared: true, source_url: "https://example.org", location: { city: "Bonn" }, ...extra,
});
const kids = row("a", "Kindertheater: Der Grüffelo");
const adults = row("b", "Karate für Erwachsene");
const maybe = row("c", "Herbstmarkt");
const notSorted = row("d", "Kinderflohmarkt");

test("the AI's verdict decides over keywords, your own choice over the AI", () => {
  const sorted = { verdicts: { [sortKey(kids)]: "yes", [sortKey(adults)]: "no", [sortKey(maybe)]: "unsure" } };
  const d = emptyDecisions();
  // "Haus der Familie" matches the keyword "famili", but the AI says no.
  assert.equal(rowState(adults, d).published, true);
  assert.equal(rowState(adults, d, sorted).published, false);
  assert.equal(rowState(maybe, d, sorted).unsure, true);
  assert.equal(rowState(notSorted, d, sorted).reason, "keyword match");
  assert.deepEqual(publishRows([kids, adults, maybe, notSorted], d, sorted).map((r) => r.event_id), ["a", "d"]);
  const mine = { ...d, events: { a: { visibility: "hide" }, c: { visibility: "show" } } };
  assert.deepEqual(publishRows([kids, adults, maybe], mine, sorted).map((r) => r.event_id), ["c"]);
  const excluded = { ...d, sources: { "bonn-city-events": "exclude" } };
  assert.equal(publishRows([kids], excluded, sorted).length, 0);
});

test("only included, undecided, unsorted titles are sent, once per title and venue", () => {
  const twin = { ...kids, event_id: "a2", start_date: "2026-11-08" };
  const other = row("e", "Lesung", { source_id: "private", cleared: false });
  const d = { ...emptyDecisions(), events: { b: { visibility: "hide" } } };
  const todo = toSort([kids, twin, adults, maybe, other], d, { [sortKey(maybe)]: "unsure" });
  assert.deepEqual(todo.map((t) => t.row.event_id), ["a"]);
  assert.deepEqual(describe(row("f", "X", { family_signals: ["source:farm", "title:kind"] }), 3),
    { i: 3, title: "X", venue: "Haus der Familie", source: "Stadt Bonn", hints: ["source:farm"] });
});

test("answers are checked and the batch keeps what it got", async () => {
  assert.deepEqual(parseAnswers('```json\n{"answers":[{"i":0,"f":"yes"},{"i":1,"f":"maybe"},{"i":9,"f":"no"}]}\n```', 2), { 0: "yes" });
  assert.deepEqual(parseAnswers("not json", 2), {});
  const items = [kids, adults].map((r) => ({ key: sortKey(r), row: r }));
  const { verdicts, error } = await sortItems(items, {}, "", async (_llm, _m, ask) => {
    assert.match(ask.text, /Karate/);
    return '{"answers":[{"i":0,"f":"yes"},{"i":1,"f":"no"}]}';
  });
  assert.equal(error, null);
  assert.deepEqual(verdicts, { [sortKey(kids)]: "yes", [sortKey(adults)]: "no" });
  const failed = await sortItems(items, {}, "", async () => { throw new Error("HTTP 402"); });
  assert.equal(failed.error.message, "HTTP 402");
});

test("verdicts for past events are dropped", () => {
  assert.deepEqual(prune({ [sortKey(kids)]: "yes", "old|": "no" }, [kids]), { [sortKey(kids)]: "yes" });
});
