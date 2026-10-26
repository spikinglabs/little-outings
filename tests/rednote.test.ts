import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { load } from "js-yaml";
import { codeOf, normCode } from "../src/lib/rednote-code.ts";
import { checkSetFile, codesOf, fileSet, fitTitle, lines, sheetSvg, weeklySet, weeklyTitle, type SetFile } from "../src/lib/rednote.ts";
import type { Edition } from "../src/lib/weekend.ts";

const edition: Edition = {
  town: "Köln", slug: "koeln", weekend: "2026-10-31", week: 44, published_at: "2026-10-30T05:00:00Z", by: "ai",
  weather: [{ day: "2026-10-31", code: 61, max: 11, rain: 80 }, { day: "2026-11-01", code: 1, max: 13, rain: 10 }],
  picks: [
    { id: "ck-evt-1", type: "event", title: "MINTköln 2026: Aktionstag", venue: "Interim Zentralbibliothek, Hohe Straße 68-82", days: ["2026-10-31"], time: "10 bis 15 Uhr", free: true, indoor: true,
      label: { de: "MINTköln Aktionstag", zh: "MINTköln 科学日" }, why: { de: "Letzter Tag.", zh: "科隆科学节最后一天。" } },
    { id: "osm-n1", type: "place", title: "Lindenthaler Tierpark", district: "Lindenthal", days: [], kind: "zoo", free: true },
  ],
};
const kindName = (k: string) => ({ zoo: "动物园和动物" })[k] ?? k;

test("codes are town letter, Saturday's day and pick number", () => {
  assert.equal(codeOf("koeln", "2026-10-31", 1), "K31-2");
  assert.equal(codeOf("berlin", "2026-11-07", 0), "B07-1");
  assert.equal(codeOf("bonn", "2026-11-07", 2), "BN07-3");
});

test("typed codes are read loosely", () => {
  for (const typed of ["K31-2", "k31-2", " k 31 2 ", "K31–2", "k312"]) assert.equal(normCode(typed), "K31-2", typed);
  assert.equal(normCode("b7-1"), "B07-1");
  assert.equal(normCode("bn07-3"), "BN07-3");
  for (const typed of ["Kino", "31-2", "spielplatz", "K31-"]) assert.equal(normCode(typed), null, typed);
});

test("the weekly set has a cover, a card per pick and a closing card", () => {
  const s = weeklySet(edition, { townZh: "科隆", kindName, more: { events: 41, places: 600 } });
  assert.equal(s.id, "koeln-2026-10-31");
  assert.equal(s.sheets.length, edition.picks.length + 2);
  assert.deepEqual(s.sheets.map((x) => x.code), [undefined, "K31-1", "K31-2", undefined]);
  assert.equal(s.sheets[1].title, "MINTköln 科学日");
  assert.ok(s.sheets[1].lines!.includes("德语原名：MINTköln 2026: Aktionstag"));
  assert.match(s.sheets[2].tag!, /随时可去 · 动物园和动物 · 免费/);
  assert.match(s.caption, /①【周六 10:00–15:00】MINTköln 科学日，Interim Zentralbibliothek（免费） 编号K31-1/);
  assert.match(s.caption, /天气：周六 有雨 11°/);
  assert.match(s.caption, /#科隆带娃/);
  assert.doesNotMatch(s.caption + JSON.stringify(s.sheets), /https?:|allo\.land/);
});

test("codes open the pick's page in any language", () => {
  assert.deepEqual(codesOf(edition), { "K31-1": "termine/ck-evt-1/", "K31-2": "orte/osm-n1/" });
});

test("the note's title stays within Rednote's 20 characters", () => {
  assert.equal(weeklyTitle("科隆", "2026-10-31"), "科隆周末带娃去哪｜10.31–11.1");
  assert.ok([...weeklyTitle("法兰克福", "2026-12-12")].length <= 20);
});

test("closing punctuation never starts a line", () => {
  for (const l of lines("孩子喝热的Kinderpunsch，大人常喝Glühwein。在威斯特法伦叫Stutenkerl，有的地方吃Martinsbrezel。", 18)) {
    assert.doesNotMatch(l, /^[，。、]/);
  }
});

test("titles shrink before they wrap and keep forced breaks", () => {
  assert.equal(fitTitle("LeseWelten 阅读时光", 888, [[96, 1], [84, 1], [84, 2]]).lines.length, 1);
  assert.deepEqual(fitTitle("科隆带娃\n周末去哪", 888, [[150, 2]]).lines, ["科隆带娃", "周末去哪"]);
});

test("every card draws as an SVG", () => {
  const s = weeklySet(edition, { townZh: "科隆", kindName, more: { events: 41, places: 600 } });
  for (const sheet of s.sheets) assert.match(sheetSvg(sheet, "1/4"), /^<svg [^>]+width="1080" height="1440"/);
});

const setFiles = readdirSync("content/rednote").filter((f) => f.endsWith(".yaml"));

test("hand-written sets are complete and carry no links", () => {
  assert.ok(setFiles.length > 0);
  for (const f of setFiles) {
    const file = load(readFileSync(`content/rednote/${f}`, "utf8")) as SetFile;
    assert.deepEqual(checkSetFile(file), [], f);
    assert.match(fileSet(f, file).caption, /#/);
  }
});

test("the Chinese font has every character the hand-written sets show", () => {
  // design/og/zh-chars.txt lists what scripts/og-font.py put in the font; rerun it when this fails.
  const have = new Set(readFileSync("design/og/zh-chars.txt", "utf8").trim());
  const text = setFiles.map((f) => readFileSync(`content/rednote/${f}`, "utf8")).join("");
  const missing = [...new Set([...text].filter((c) => c >= "⺀" && c <= "￯" && !have.has(c)))];
  assert.deepEqual(missing, []);
});

test("a pick that dropped out leaves the other codes as posted", () => {
  const live = { ...edition, picks: edition.picks.slice(1) };
  const s = weeklySet(live, { townZh: "科隆", kindName, more: { events: 1, places: 1 }, codes: ["K31-2"] });
  assert.equal(s.sheets[1].code, "K31-2");
  assert.deepEqual(codesOf(live, ["K31-2"]), { "K31-2": "orte/osm-n1/" });
});

test("the last line is never one or two lone characters", () => {
  const l = lines("傍晚天黑后集合，通常在17点到18点之间。", 18);
  assert.ok([...l.at(-1)!].length > 3, l.join("|"));
});
