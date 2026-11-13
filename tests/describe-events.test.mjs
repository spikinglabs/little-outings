import { test } from "node:test";
import assert from "node:assert/strict";
import { excerptFor, keyOf, namesEvent, parseAbout, update, wanted } from "../scripts/describe-events.mjs";
import { fromExport } from "../scripts/import-cityklub.mjs";

const URL1 = "https://www.stadtbibliothek.example/bilderbuchkino";
const row = { event_id: "e1", title: "Bilderbuchkino", start_date: "2026-11-14", family: true,
  location: { city: "Köln" }, source_id: "koeln-bib", source_url: URL1, venue: "Stadtbibliothek" };
const PAGE = "Bilderbuchkino\nWir zeigen ein Bilderbuch groß auf der Leinwand und lesen es vor. Für Kinder von 4 bis 7 Jahren. Eintritt frei.";
const answer = (o) => JSON.stringify({ found: true, de: "Ein Bilderbuch wird groß gezeigt und vorgelesen.", en: "A picture book is shown on a big screen and read aloud.", zh: "大屏幕放映绘本并朗读。", age_quote: "", age_min: null, age_max: null, ...o });

test("ages are kept only when the quoted words are on the page and hold the numbers", () => {
  assert.deepEqual(parseAbout(answer({ age_quote: "Für Kinder von 4 bis 7 Jahren", age_min: 4, age_max: 7 }), PAGE).ages, [4, 7]);
  // Not on the page: the model made it up.
  assert.equal(parseAbout(answer({ age_quote: "ab 3 Jahren", age_min: 3 }), PAGE).ages, undefined);
  // On the page, but the numbers don't match the quote.
  assert.equal(parseAbout(answer({ age_quote: "Für Kinder von 4 bis 7 Jahren", age_min: 3, age_max: 7 }), PAGE).ages, undefined);
  // Only a lower bound: up to 18.
  assert.deepEqual(parseAbout(answer({ age_quote: "ab 6 Jahren", age_min: 6 }), "Workshop ab 6 Jahren").ages, [6, 18]);
  // Only an upper bound.
  assert.deepEqual(parseAbout(answer({ age_quote: "Kinder bis 3 Jahre", age_min: 0, age_max: 3 }), "Krabbelgruppe für Kinder bis 3 Jahre").ages, [0, 3]);
  // No age: none.
  assert.equal(parseAbout(answer({}), PAGE).ages, undefined);
});

test("a sentence needs all three languages and found: true", () => {
  assert.equal(parseAbout(answer({}), PAGE).zh, "大屏幕放映绘本并朗读。");
  assert.deepEqual(parseAbout(answer({ found: false, de: "", en: "", zh: "" }), PAGE), { none: true });
  assert.deepEqual(parseAbout(answer({ zh: "" }), PAGE), { none: true });
});

test("a long calendar page sends the passage around the title", () => {
  const page = "x ".repeat(10000) + "Bilderbuchkino am Samstag " + "y ".repeat(10000);
  const ex = excerptFor(page, "Bilderbuchkino");
  assert.ok(ex.length <= 12000);
  assert.match(ex, /Bilderbuchkino am Samstag/);
});

test("tonight's events only, soonest first", () => {
  const rows = [{ ...row, start_date: "2026-11-20" }, row, { ...row, start_date: "2026-12-30" }, { ...row, start_date: "2026-11-01" }];
  assert.deepEqual(wanted(rows, "2026-11-13", "2026-11-27").map((r) => r.start_date), ["2026-11-14", "2026-11-20"]);
});

test("each page is read once per run, cached by page and title, and stale entries are dropped", async () => {
  let pages = 0;
  const fetch = async (url) => {
    if (url === URL1) { pages++; return new Response(`<html><body><p>${PAGE}</p></body></html>`); }
    return Response.json({ candidates: [{ content: { parts: [{ text: answer({ age_quote: "Für Kinder von 4 bis 7 Jahren", age_min: 4, age_max: 7 }) }] } }] });
  };
  const rows = [row, { ...row, event_id: "e2", title: "Vorlesestunde" }];
  const r = await update(rows, { "https://old.example | x": { none: true } }, { llm: { provider: "gemini", key: "k" }, today: "2026-11-13", until: "2026-11-27", fetch });
  assert.equal(pages, 1);
  assert.equal(r.done, 2);
  assert.deepEqual(Object.keys(r.cache).sort(), [keyOf(rows[1]), keyOf(row)].sort());
  const again = await update(rows, r.cache, { llm: { provider: "gemini", key: "k" }, today: "2026-11-13", until: "2026-11-27", fetch });
  assert.equal(again.done, 0);
});

test("the import adds the sentence and the page's ages", () => {
  const towns = [{ name: "Köln", lat: 50.94, lon: 6.96 }];
  const about = { [keyOf(row)]: { de: "Satz.", en: "Sentence.", zh: "句子。", ages: [4, 7] } };
  const ev = fromExport(row, { towns, today: "2026-11-13", about });
  assert.deepEqual(ev.data.about, { de: "Satz.", en: "Sentence.", zh: "句子。" });
  assert.deepEqual(ev.data.ages, [4, 7]);
  assert.equal(fromExport(row, { towns, today: "2026-11-13" }).data.about, undefined);
});

test("a calendar page without the title lends no age or sentence", () => {
  const filters = "Für wen?\nKinder ab 5 Jahren\nKinder ab 6 Jahren\nWo?\nMuseum Ludwig";
  assert.equal(namesEvent(filters, "Rundgang für Familien durch return"), false);
  assert.equal(namesEvent("FAMILIENTAG Magie der Materialien – Wenn Dinge Kunst werden. Ab 6 Jahren.", "FAMILIENTAG Magie der Materialien – Wenn Dinge Kunst werden (neu)"), true);
  // An age from the filter list far above the event is not the event's age.
  const page = filters + "\n" + "x ".repeat(2000) + "\nVorlesezeit\nWir lesen Bilderbücher vor.";
  assert.equal(parseAbout(answer({ age_quote: "Kinder ab 5 Jahren", age_min: 5 }), page, "Vorlesezeit").ages, undefined);
  assert.deepEqual(parseAbout(answer({ age_quote: "ab 3 Jahren", age_min: 3 }), "Vorlesezeit\nFür Kinder ab 3 Jahren.", "Vorlesezeit").ages, [3, 18]);
});
