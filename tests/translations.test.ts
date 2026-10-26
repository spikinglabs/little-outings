import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTranslations, normalizeEvent, normalizePlace } from "../src/lib/merge.ts";
import { germanName, nameOf } from "../src/lib/format.ts";

const towns = [{ name: "Velbert", lat: 51.34, lon: 7.043 }];
const zh = { Hoffest: "农场节", Schanzenweg: "Schanzenweg 游乐场", "Kids Yoga": "儿童瑜伽" };
const en = { Hoffest: "Farm festival", "Kids Yoga": "Kids Yoga" };
const ev = (title: any, caches: any = { zh }) => applyTranslations(normalizeEvent("e", { title, town: "Velbert", start: "2026-10-11" }, {}, new Map(), towns)!, caches);
const place = applyTranslations(normalizePlace("p", { kind: "playground", name: "Schanzenweg", address: { town: "Velbert" } }, undefined, towns), { zh, en });

test("a cached Chinese title shows in Chinese, with the German original beneath", () => {
  const e = ev("Hoffest");
  assert.equal(nameOf(e, "zh"), "农场节");
  assert.equal(germanName(e, "zh"), "Hoffest");
  assert.equal(nameOf(e, "de"), "Hoffest");
  assert.equal(germanName(e, "de"), undefined);
  assert.equal(nameOf(e, "en"), "Hoffest", "English falls back to German");
});

test("a cached English title shows on the English site, with the German original beneath", () => {
  const e = ev("Hoffest", { en, zh });
  assert.equal(nameOf(e, "en"), "Farm festival");
  assert.equal(germanName(e, "en"), "Hoffest");
  assert.equal(nameOf(e, "zh"), "农场节");
  assert.equal(nameOf(e, "de"), "Hoffest");
  assert.deepEqual(e.machine, ["en", "zh"]);
});

test("a title that is already English shows as is, with no German line", () => {
  const e = ev("Kids Yoga", { en, zh });
  assert.equal(nameOf(e, "en"), "Kids Yoga");
  assert.equal(germanName(e, "en"), undefined);
  assert.equal(germanName(e, "zh"), "Kids Yoga");
});

test("a title translated by hand wins and is not marked as machine-translated", () => {
  const e = ev({ de: "Hoffest", zh: "丰收节" });
  assert.equal(nameOf(e, "zh"), "丰收节");
  assert.equal(germanName(e, "zh"), undefined);
});

test("places get a Chinese name only on the Chinese site", () => {
  assert.equal(nameOf(place, "zh"), "Schanzenweg 游乐场");
  assert.equal(germanName(place, "zh"), "Schanzenweg");
  assert.equal(nameOf(place, "en"), "Schanzenweg");
});

test("parents' answers replace the title guess; a tie keeps it; an editor's answer stays", async () => {
  const { applyEventTally } = await import("../src/lib/merge.ts");
  const guessed = normalizeEvent("g", { title: "Lesung", town: "Velbert", start: "2026-10-11", language: "de", origin: "cityklub" }, {}, new Map(), towns)!;
  assert.equal(guessed.languageFrom, "guess");
  assert.equal(applyEventTally(guessed, { lang: { none: 2, de: 1 } }).language, "none");
  assert.equal(applyEventTally(guessed, { lang: { none: 2, de: 1 } }).languageFrom, "parents");
  assert.equal(applyEventTally(guessed, { lang: { none: 1, de: 1 } }).languageFrom, "guess");
  const edited = normalizeEvent("h", { title: "Lesung", town: "Velbert", start: "2026-10-11", language: "de", origin: "cityklub" },
    { override: { language: "en" } }, new Map(), towns)!;
  const out = applyEventTally(edited, { lang: { none: 5 } });
  assert.deepEqual([out.language, out.languageFrom, out.languageVotes], ["en", "editor", { none: 5 }]);
});
