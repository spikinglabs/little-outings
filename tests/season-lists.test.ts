import { test } from "node:test";
import assert from "node:assert/strict";
import { load as parseYaml } from "js-yaml";
import { cleanItem, fixturePath, fixtureYaml, slugify, uniqueItems } from "../admin/lib/season-lists.js";
import { parseFixtures } from "../src/lib/seasons.ts";
import { mergeDetail, pageText, parseJson } from "../scripts/season-lists.mjs";

test("slugify turns names into file-safe ids", () => {
  assert.equal(slugify("Weihnachtsmarkt am Kölner Dom"), "weihnachtsmarkt-am-koelner-dom");
  assert.equal(slugify("Märchen-Weihnachtsmarkt „Alter Markt“"), "maerchen-weihnachtsmarkt-alter-markt");
  assert.equal(slugify(""), "item");
});

test("cleanItem keeps only well-formed rows and known kids", () => {
  assert.equal(cleanItem({ name: "X", from: "2026-11-20" }).to, "2026-11-20");
  assert.equal(cleanItem({ name: "", from: "2026-11-20" }), null);
  assert.equal(cleanItem({ name: "X", from: "20.11.2026" }), null);
  assert.equal(cleanItem({ name: "X", from: "2026-11-20", to: "2026-11-01" }), null);
  const it = cleanItem({ name: "Dom", from: "2026-11-16", to: "2026-12-23", kids: ["carousel", "dragons"], free: true,
    website: "javascript:alert(1)", geo: { lat: "50.94025", lon: 6.957991 }, note: { de: "Karussell", en: "", zh: null }, hours: "  " });
  assert.deepEqual(it.kids, ["carousel"]);
  assert.equal(it.website, undefined);
  assert.equal(it.hours, undefined);
  assert.deepEqual(it.geo, { lat: 50.94025, lon: 6.95799 });
  assert.deepEqual(it.note, { de: "Karussell" });
});

test("uniqueItems sorts and numbers repeated ids", () => {
  const rows = uniqueItems([
    { name: "Weihnachtsmarkt", from: "2026-11-27" },
    { name: "Weihnachtsmarkt", from: "2026-11-20" },
    { name: "Bad", from: "x" },
  ]);
  assert.deepEqual(rows.map((r: any) => [r.id, r.from]), [["weihnachtsmarkt", "2026-11-20"], ["weihnachtsmarkt-2", "2026-11-27"]]);
});

test("fixtureYaml writes a file the site reads back", () => {
  const text = fixtureYaml({
    comment: "drafted by AI\napproved", town: "Köln", source: "koeln.de", checked: "2026-10-26",
    items: [{ name: 'Markt "am Dom": 1', from: "2026-11-16", to: "2026-12-23", street: "Roncalliplatz", geo: { lat: 50.94, lon: 6.958 },
      kids: ["carousel", "nativity"], free: true, website: "https://example.org/a#b", note: { de: "Ein Satz: mit Doppelpunkt", zh: "旋转木马" } }],
  });
  assert.match(text, /^# drafted by AI\n# approved\n/);
  const file = parseFixtures("advent", "koeln", parseYaml(text));
  assert.equal(file.town, "Köln");
  assert.equal(file.checked, "2026-10-26");
  const [it] = file.items;
  assert.equal(it.name, 'Markt "am Dom": 1');
  assert.equal(it.id, "markt-am-dom-1");
  assert.deepEqual(it.geo, { lat: 50.94, lon: 6.958 });
  assert.deepEqual(it.kids, ["carousel", "nativity"]);
  assert.deepEqual(it.note, { de: "Ein Satz: mit Doppelpunkt", zh: "旋转木马" });
});

test("fixturePath refuses odd names", () => {
  assert.equal(fixturePath("advent", "koeln"), "content/seasons/advent/koeln.yaml");
  assert.throws(() => fixturePath("advent", "../x"));
});

test("pageText keeps text and absolute links, drops scripts and menus", () => {
  const { text, links } = pageText('<nav>Menü</nav><h1>Märkte</h1><script>x()</script><p>Dom&nbsp;&amp; Altstadt</p><a href="/dom/">Am <b>Dom</b></a>', "https://www.koeln.de/weihnachten/");
  assert.match(text, /Märkte\nDom & Altstadt/);
  assert.doesNotMatch(text, /Menü|x\(\)/);
  assert.deepEqual(links, [{ text: "Am Dom", url: "https://www.koeln.de/dom/" }]);
});

test("parseJson and mergeDetail", () => {
  assert.deepEqual(parseJson('Here: {"a": 1} done'), { a: 1 });
  assert.equal(parseJson("no json"), null);
  const row = { name: "Dom", from: "2026-11-16", to: "2026-12-23", street: "Roncalliplatz", kids: ["carousel"] };
  const merged = mergeDetail(row, { from: null, hours: "11–21 Uhr", street: "", kids: ["nativity"], note: { de: "Krippe" } });
  assert.equal(merged.from, "2026-11-16");
  assert.equal(merged.street, "Roncalliplatz");
  assert.equal(merged.hours, "11–21 Uhr");
  assert.deepEqual(merged.kids, ["carousel", "nativity"]);
  assert.deepEqual(merged.note, { de: "Krippe" });
});
