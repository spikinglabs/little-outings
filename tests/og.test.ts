import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dateHeadline, dateSign, eventKey, fitHeadline, placeKey, seasonKey, squareSvg, wideSvg, wrap } from "../src/lib/og.ts";

// Enough of useT for the date sign: the strings it asks for, per language.
const fakeT = (lang: "de" | "en" | "zh", locale: string) => {
  const words: Record<string, string> = { de: "bis", en: "until", zh: "至" };
  const t = ((key: string, vars?: Record<string, string>) =>
    key === "og.until" ? words[lang] : key === "runsUntil" ? `${words[lang]} ${vars!.date}` : key) as any;
  t.lang = lang;
  t.locale = locale;
  return t;
};

test("an event shows its day, a long run its last day; places their kind", () => {
  assert.equal(eventKey({ start: "2026-11-08", end: "2026-11-08" }), "d-2026-11-08");
  assert.equal(eventKey({ start: "2026-11-08", end: "2026-11-09" }), "d-2026-11-08");
  assert.equal(eventKey({ start: "2026-11-01", end: "2026-12-24" }), "u-2026-12-24");
  assert.equal(placeKey({ kind: "pool" }), "k-pool");
  assert.equal(placeKey({ kind: "something-new" }), "k-park");
  assert.equal(seasonKey("advent", "koeln"), "s-advent-koeln");
  assert.equal(seasonKey("advent"), "s-advent");
});

test("the date sign reads like the card stamp, in each language", () => {
  assert.deepEqual(dateSign(fakeT("de", "de-DE"), "d-2026-11-08"), { type: "date", top: "So", day: "8", mon: "Nov" });
  assert.deepEqual(dateSign(fakeT("zh", "zh-CN"), "d-2026-11-08"), { type: "date", top: "周日", day: "8", mon: "11月" });
  assert.equal(dateSign(fakeT("en", "en-GB"), "u-2026-12-24").type === "date" && (dateSign(fakeT("en", "en-GB"), "u-2026-12-24") as any).top, "until");
  assert.equal(dateHeadline(fakeT("de", "de-DE"), "d-2026-11-08"), "Sonntag, 8. November");
  assert.equal(dateHeadline(fakeT("de", "de-DE"), "u-2026-12-24"), "Bis Donnerstag, 24. Dezember");
});

test("headlines wrap at spaces, Chinese anywhere, and shrink to fit", () => {
  assert.deepEqual(wrap("Weihnachtsmärkte mit Kindern in Köln", 12), ["Weihnachtsmärkte mit", "Kindern in Köln"]);
  assert.deepEqual(wrap("Spielplatz", 3), ["Spielplatz"]);
  assert.ok(wrap("科隆：带孩子逛圣诞市场", 5).every((l) => [...l].length <= 5));
  assert.equal(fitHeadline("Spielplatz", 660).size, 84);
  const long = fitHeadline("Weihnachtsmärkte mit Kindern in Mönchengladbach und Umgebung am Niederrhein", 660);
  assert.ok(long.size < 84 && long.lines.length <= 4);
});

test("pictures escape text and size themselves for og:image and WeChat", () => {
  const card = { sign: { type: "icon" as const, icon: "<path/>", tone: "braun" as const }, headline: "Parks & gardens", sub: "Family <outings>", brand: "Little Outings" };
  const wide = wideSvg(card);
  assert.match(wide, /width="1200" height="630"/);
  assert.match(wide, /Parks &amp;/);
  assert.match(wide, /Family &lt;outings&gt;/);
  assert.match(squareSvg(card), /width="600" height="600"/);
});

test("the Chinese font has every character the pictures can show", () => {
  // design/og/zh-chars.txt lists what scripts/og-font.py put in the font; rerun it when this fails.
  const have = new Set(readFileSync("design/og/zh-chars.txt", "utf8").trim());
  const sources = ["i18n/zh.yaml", "content/seasons.yaml", ...readdirSync("content/regions").map((f) => `content/regions/${f}`)];
  let text = sources.map((f) => readFileSync(f, "utf8")).join("");
  const t = fakeT("zh", "zh-CN");
  for (let d = 0; d < 366; d++) {
    const day = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
    text += dateHeadline(t, `d-${day}`) + JSON.stringify(dateSign(t, `d-${day}`));
  }
  const missing = [...new Set([...text].filter((c) => c >= "⺀" && c <= "￯" && !have.has(c)))];
  assert.deepEqual(missing, []);
});

test("every season has its emoji picture for the preview sign", () => {
  // design/og/README.md says where to get one (Twemoji, named by code points).
  const emoji = [...readFileSync("content/seasons.yaml", "utf8").matchAll(/^\s+emoji: "([^"]+)"/gm)].map((m) => m[1]);
  const file = (e: string) => [...e].map((c) => c.codePointAt(0)!.toString(16)).filter((c) => c !== "fe0f").join("-");
  assert.ok(emoji.length > 0);
  assert.deepEqual(emoji.filter((e) => !existsSync(`design/og/emoji/${file(e)}.svg`)), []);
});
