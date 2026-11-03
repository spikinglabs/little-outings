import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { load } from "js-yaml";
import { codeOf, normCode } from "../src/lib/rednote-code.ts";
import { alertSet, alertWhen, checkSetFile, codesOf, fileSet, fitTitle, lines, sheetSvg, weeklySet, weeklyTitle, type SetFile } from "../src/lib/rednote.ts";
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
  assert.equal(codeOf("essen", "2026-11-07", 0), "E07-1");
  assert.equal(codeOf("aachen", "2026-11-07", 4), "A07-5");
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
  // Only the cards are drawn; the caption is pasted as text, so it may carry emoji.
  const text = setFiles.map((f) => JSON.stringify((load(readFileSync(`content/rednote/${f}`, "utf8")) as SetFile).cards)).join("");
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

test("captions speak to mums and dads alike", () => {
  const weekly = weeklySet(edition, { townZh: "科隆", kindName, more: { events: 1, places: 1 } }).caption;
  const sets = setFiles.map((f) => fileSet(f, load(readFileSync(`content/rednote/${f}`, "utf8")) as SetFile).caption);
  for (const caption of [weekly, ...sets]) {
    assert.equal(caption.includes("#德国妈妈"), caption.includes("#德国爸爸"), caption.slice(-80));
  }
});

test("every caption carries our own #小鹿出游 tag first", () => {
  const weekly = weeklySet(edition, { townZh: "科隆", kindName, more: { events: 1, places: 1 } }).caption;
  const sets = setFiles.map((f) => fileSet(f, load(readFileSync(`content/rednote/${f}`, "utf8")) as SetFile).caption);
  for (const caption of [weekly, ...sets]) {
    assert.match(caption, /\n#小鹿出游 #/, caption.slice(-80));
    assert.equal(caption.split("#小鹿出游").length, 2);
  }
});

test("a space between Chinese and Latin stays in the wrapped lines", () => {
  const l = lines("在浏览器里搜索「小鹿出游 Allo\u00a0Outings」，再在网站的搜索框输入卡片右下角的编号，就能直接打开那个活动。", 15.5);
  assert.ok(l.join("").includes("小鹿出游 Allo") || l.some((x) => x.endsWith("小鹿出游")), l.join("|"));
  assert.ok(!l.join("|").includes("小鹿出游Allo"));
  assert.ok(l.some((x) => x.includes("Allo Outings")), "the brand stays on one line");
  assert.deepEqual(lines("喝热的Kinderpunsch。", 40), ["喝热的Kinderpunsch。"], "no space is added where there was none");
});


test("a confirmed city alert becomes a set: facts, what to watch for, an invitation to add more, no link", () => {
  const alert = { id: "rec_abc123def456", city: "Köln", day: "2026-10-31", from: "14:00", to: "18:00", kind: "police_notice", line: { zh: "莱茵河岸大型游行，道路封闭，电车改道。" } };
  const s = alertSet(alert, "科隆");
  assert.equal(s.id, "alert-koeln-2026-10-31-def456");
  assert.equal(s.title, "科隆出行提醒｜10月31日周六");
  assert.ok([...s.title].length <= 20);
  assert.equal(alertWhen(alert), "10月31日周六 14:00–18:00");
  assert.equal(alertWhen({ ...alert, until: "2026-11-01", from: undefined }), "10月31日周六–11月1日周日");
  assert.equal(s.sheets.length, 3);
  assert.ok(s.sheets[1].lines?.includes(alert.line.zh));
  assert.match(s.caption, /评论区补充/);
  assert.ok(s.caption.includes(alert.line.zh));
  assert.ok(s.caption.split("\n").at(-1)!.startsWith("#小鹿出游 "));
  assert.doesNotMatch(s.caption + JSON.stringify(s.sheets), /不用紧张|不用担心|https?:|allo\.land/);
  assert.deepEqual(checkSetFile({ title: s.title, caption: s.caption, cards: s.sheets }), []);
  for (const sheet of s.sheets) assert.match(sheetSvg(sheet), /^<svg/);
  // With the facts from the page: a type in the title, a card with place, route, size and lines, the key points.
  const rich = alertSet({ ...alert, type: "march", expected: 15000, route: "Deutzer Brücke – Heumarkt", lines: ["KVB 1", "KVB 7"],
    about: { zh: "X 倡议组织的游行。" }, points: { zh: ["莱茵河岸封闭"] } }, "科隆");
  assert.equal(rich.title, "科隆游行出行提醒｜10月31日周六");
  assert.equal(rich.sheets.length, 4);
  assert.deepEqual(rich.sheets[2].lines, ["路线：Deutzer Brücke – Heumarkt", "预计人数：约1.5万人", "受影响线路：KVB 1、KVB 7", "莱茵河岸封闭"]);
  assert.match(rich.caption, /X 倡议组织的游行。/);
  assert.match(rich.caption, /📍预计人数：约1\.5万人/);
  // Long background and many points go on to further cards, whole; a point with a web address stays off Rednote.
  const long = "警方表示，集会的主题是教育、义务兵役和可负担的生活，组织者预计会有很多年轻人参加，集会结束后可能转为游行。";
  const big = alertSet({ ...alert, type: "demonstration", where: "Konrad-Adenauer-Ufer", about: { zh: long.repeat(6) },
    points: { zh: [long, long, long, long, long, "更多交通信息：hamburg.de/verkehr/polizeimeldungen"] } }, "科隆");
  const titles = big.sheets.map((sh) => sh.title);
  assert.deepEqual(titles.slice(1, -1).map((t) => t.slice(0, 2)), ["发生", "发生", "具体", "具体"]);
  assert.equal(big.sheets.filter((sh) => sh.title === "发生什么").flatMap((sh) => sh.lines).join("").includes(long.repeat(6)), true, "nothing lost");
  for (const sh of big.sheets) for (const l of sh.lines ?? []) assert.ok(lines(l, 18.4).length <= 3, l);
  assert.doesNotMatch(big.sheets.map((sh) => sheetSvg(sh)).join("") + big.caption, /…|hamburg\.de/);
  // A transit strike gets transit advice.
  assert.match(alertSet({ ...alert, kind: "strike" }, "科隆").caption, /交通 App/);
});

test("the Chinese font has every character the alert cards always show", () => {
  const have = new Set(readFileSync("design/og/zh-chars.txt", "utf8").trim());
  const s = alertSet({ id: "x", city: "Köln", day: "2026-11-02", kind: "assembly", line: { zh: "" } }, "科隆");
  const fixed = alertSet({ id: "x", city: "Köln", day: "2026-11-02", kind: "strike", line: { zh: "" } }, "科隆");
  const typed = ["demonstration", "march", "police_operation", "closure", "strike", "evacuation", "crowd_event", "other"]
    .map((type) => alertSet({ id: "x", city: "Köln", day: "2026-11-02", kind: "police_notice", type, expected: 15000, where: "-", route: "-", lines: ["1"], line: { zh: "" } }, "科隆"));
  const missing = [...new Set([...(JSON.stringify(s.sheets) + JSON.stringify(fixed.sheets) + JSON.stringify(typed.map((x) => x.sheets)))].filter((c) => c.charCodeAt(0) >= 0x2e80 && !have.has(c)))];
  assert.deepEqual(missing, []);
});
