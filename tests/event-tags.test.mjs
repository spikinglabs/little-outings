import { test } from "node:test";
import assert from "node:assert/strict";
import { languageOf, tagsOf } from "../scripts/event-tags.mjs";

test("event types come from the title, and a few from the venue", () => {
  assert.deepEqual(tagsOf("Regelmäßige Vorlesestunde", "Stadtbibliothek"), ["reading"]);
  assert.deepEqual(tagsOf("Dialog in Deutsch", "Stadtbibliothek"), [], "a library venue alone is not story time");
  assert.deepEqual(tagsOf("Kinderflohmarkt St. Severin"), ["market"]);
  assert.deepEqual(tagsOf("Herbstferien Kids Clay Workshop"), ["diy", "season"]);
  assert.deepEqual(tagsOf("Die Nachtigall", "Kinderoper"), ["stage"]);
  assert.deepEqual(tagsOf("Hoffest", "Gut Hixholz Bauernhof"), ["animals", "fest"]);
});

test("how much German an event needs", () => {
  const lang = (title, venue) => languageOf(title, tagsOf(title, venue));
  assert.equal(lang("English Story Time"), "en");
  assert.equal(lang("Zweisprachiges Bilderbuchkino"), "en");
  assert.equal(lang("Regelmäßige Vorlesestunde"), "de");
  assert.equal(lang("Familienführung", "Museum Ludwig"), "de");
  assert.equal(lang("Schreibwerkstatt: Wortwerke"), "de", "a writing workshop is talk, even though it is a workshop");
  assert.equal(lang("Hoffest", "Gut Hixholz Bauernhof"), "none");
  assert.equal(lang("Kinderflohmarkt St. Severin"), "none");
  assert.equal(lang("Vorlesezeit auf Türkisch"), undefined, "another language: no label");
  assert.equal(lang("Aktionstage Nachhaltigkeit"), undefined, "no clue in the title");
});
