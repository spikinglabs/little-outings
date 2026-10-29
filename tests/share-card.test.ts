import { test } from "node:test";
import assert from "node:assert/strict";
import { clip, rednoteText, shareCard } from "../src/lib/share-card.ts";
import { sheetSvg, XHS } from "../src/lib/sheet.ts";
import { textEm } from "../src/lib/og.ts";

const t = ((k: string, v?: Record<string, string>) => (k === "share.cardGerman" ? `德语原名：${v!.name}` : k === "share.cardFoot" ? "出发前请再确认" : k)) as never;

test("clip keeps short text and cuts long text with …", () => {
  assert.equal(clip("Kurz", 20), "Kurz");
  const long = clip("Ein langer Text über ein Fest mit Laternen und Musik für die ganze Familie im Park", 30);
  assert.ok(long.endsWith("…") && textEm(long) <= 30, long);
  assert.ok(!/\s…$/.test(long));
  assert.ok(clip("这是一个很长很长很长很长很长很长很长很长很长很长的中文句子", 10).endsWith("…"));
});

test("the share card drops empty lines and names the site without a link", () => {
  const zh = shareCard("zh", { tone: "gold", tag: "10月31日 · 10:00", title: "灯笼游行", german: "Martinszug", lines: ["Bonn", "", undefined, false, "免费"], note: "Mit Laternen." }, t);
  assert.deepEqual(zh.lines, ["德语原名：Martinszug", "Bonn", "免费"]);
  assert.equal(zh.search, "小鹿出游 Allo Outings");
  assert.equal(shareCard("de", { tone: "paper", tag: "Spielplatz", title: "Spielplatz", german: "Spielplatz", lines: [] }, t).lines!.length, 0);
  assert.doesNotMatch(JSON.stringify(zh), /https?:|www\./);
});

test("the card's text stays above the brand line however much there is", () => {
  const svg = sheetSvg(shareCard("en", {
    tone: "gold", tag: "Saturday 31 October 2026 · 10:00–18:00", title: "A very long event title that needs three lines on the card to fit",
    german: "Ein sehr langer deutscher Titel", lines: ["Some venue with a long name, Street 1, Cologne", "Free", "Ages 3 to 10", "Indoors"],
    note: "A long note ".repeat(20),
  }, t));
  const ys = [...svg.matchAll(/<text x="96" y="([\d.]+)"/g)].map((m) => Number(m[1]));
  const brand = XHS.h - 96 - 4;
  // Everything but the small print and the brand sits above the small print.
  assert.ok(ys.filter((y) => y < brand - 92).every((y) => y <= XHS.h - 96 - 92 - 60), ys.join(","));
});

test("the Rednote text has no link and leads its tags with #小鹿出游", () => {
  const text = rednoteText("灯笼游行", ["11月11日", "Bonn"], "波恩");
  assert.doesNotMatch(text, /https?:|www\.|allo\.land/);
  assert.match(text, /搜索「小鹿出游 Allo Outings」/);
  assert.match(text.split("\n").at(-1)!, /^#小鹿出游 #德国带娃 #波恩带娃/);
});
