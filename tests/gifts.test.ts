import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGifts, parseGifts } from "../src/lib/gifts.ts";

test("the gifts file loads, with every town and custom in all three languages", () => {
  const g = loadGifts();
  assert.ok(g.towns.length >= 5);
  for (const t of g.towns) for (const item of t.items) for (const l of ["de", "en", "zh"]) assert.ok((item.note as any)[l], `${t.slug} ${item.name} ${l}`);
  for (const c of g.customs) for (const l of ["de", "en", "zh"]) {
    assert.ok((c.title as any)[l] && (c.text as any)[l] && (c.when as any)[l], `${c.id} ${l}`);
  }
});

test("a gift needs a known kind and an https link", () => {
  const town = (item: object) => ({ checked: "2026-11-12", towns: [{ slug: "koeln", town: "Köln", items: [item] }] });
  assert.throws(() => parseGifts(town({ kind: "toy", name: "x", note: "y", url: "https://a.de" })), /kind/);
  assert.throws(() => parseGifts(town({ kind: "pass", name: "x", note: "y", url: "http://a.de" })), /https/);
  assert.equal(parseGifts(town({ kind: "pass", name: "x", note: "y", url: "https://a.de" })).towns[0].items.length, 1);
});
