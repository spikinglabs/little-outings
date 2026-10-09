import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTranslations, normalizeEvent, normalizePlace } from "../src/lib/merge.ts";
import { germanName, nameOf } from "../src/lib/format.ts";

const towns = [{ name: "Velbert", lat: 51.34, lon: 7.043 }];
const zh = { Hoffest: "农场节", Schanzenweg: "Schanzenweg 游乐场" };
const ev = (title: any) => applyTranslations(normalizeEvent("e", { title, town: "Velbert", start: "2026-10-11" }, {}, new Map(), towns)!, zh);
const place = applyTranslations(normalizePlace("p", { kind: "playground", name: "Schanzenweg", address: { town: "Velbert" } }, undefined, towns), zh);

test("a cached Chinese title shows in Chinese, with the German original beneath", () => {
  const e = ev("Hoffest");
  assert.equal(nameOf(e, "zh"), "农场节");
  assert.equal(germanName(e, "zh"), "Hoffest");
  assert.equal(nameOf(e, "de"), "Hoffest");
  assert.equal(germanName(e, "de"), undefined);
  assert.equal(nameOf(e, "en"), "Hoffest", "English falls back to German");
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
