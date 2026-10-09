import { test } from "node:test";
import assert from "node:assert/strict";
import { tagsOf } from "../scripts/event-tags.mjs";

test("event types come from the title, and a few from the venue", () => {
  assert.deepEqual(tagsOf("Regelmäßige Vorlesestunde", "Stadtbibliothek"), ["reading"]);
  assert.deepEqual(tagsOf("Dialog in Deutsch", "Stadtbibliothek"), [], "a library venue alone is not story time");
  assert.deepEqual(tagsOf("Kinderflohmarkt St. Severin"), ["market"]);
  assert.deepEqual(tagsOf("Herbstferien Kids Clay Workshop"), ["diy", "season"]);
  assert.deepEqual(tagsOf("Die Nachtigall", "Kinderoper"), ["stage"]);
  assert.deepEqual(tagsOf("Hoffest", "Gut Hixholz Bauernhof"), ["animals", "fest"]);
});
