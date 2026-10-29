// Rednote (小红书) picture sets, for the Chinese-speaking parents in Germany who plan outings there.
// Rednote punishes links and QR codes (in notes, comments and the profile), so every card carries the
// whole story: name, day, time, place, price. The bridge to the site is the name 小鹿出游 and a short code
// per pick (src/lib/rednote-code.ts) that the site's search box opens.
//
// Nothing is posted from here: Rednote has no posting API, and bots that post anyway get accounts
// banned. The build draws the cards (src/pages/xhs/), the admin's Rednote box shows them with the
// caption, and someone posts them by hand.
//
//   weekly   one set per town in REDNOTE_TOWNS from its weekend edition: cover, one card per pick, closing card
//   sets     hand-written explainers in content/rednote/<id>.yaml (St. Martin …), drawn until their `until` day
//
// Cards are 1080×1440 (3:4, what Rednote shows uncropped), drawn by src/lib/sheet.ts. Plain TypeScript, so tests run it in Node.
import type { Sheet } from "./sheet.ts";
import { codeOf } from "./rednote-code.ts";
import { addDays, textIn, townSlug, weatherLine, whenShort, WEEKEND_TOWNS, type Edition, type Pick } from "./weekend.ts";

export { XHS, fitTitle, lines, sheetSvg, type Sheet } from "./sheet.ts";

/** Towns whose weekend edition gets a Rednote set, by slug: every weekend town (one without an edition yet is skipped). */
export const REDNOTE_TOWNS = WEEKEND_TOWNS.map(townSlug);

/** A finished set: what the admin shows next to the pictures, ready to copy. */
export interface XhsSet { id: string; title: string; caption: string; sheets: Sheet[] }

// ---------- the weekly set ----------

const TAGS = (town: string) => ["德国带娃", `${town}带娃`, town, "周末去哪儿", "遛娃", "德国生活", "德国妈妈", "德国爸爸", "留德"];
/** Our own tag leads every caption, so posts and parents' shares all gather under #小鹿出游. */
export const BRAND_TAG = "小鹿出游";
export const hashtags = (tags: string[]) => [BRAND_TAG, ...tags.filter((t) => t !== BRAND_TAG)].map((t) => `#${t}`).join(" ");

const md = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
const venueOf = (p: Pick) => (p.venue ?? "").trim();
const nameOf = (p: Pick) => textIn(p.label, "zh", p.title);

/** The note's title, at most 20 characters (Rednote's limit): "科隆周末带娃去哪｜10.31–11.1". */
export function weeklyTitle(townZh: string, saturday: string): string {
  const full = `${townZh}周末带娃去哪｜${md(saturday)}–${md(addDays(saturday, 1))}`;
  return [...full].length <= 20 ? full : `${townZh}周末带娃去哪`;
}

function pickTag(p: Pick, kindName: (k: string) => string): string {
  if (p.type === "place") return ["随时可去", p.kind ? kindName(p.kind) : "", p.free ? "免费" : ""].filter(Boolean).join(" · ");
  return [whenShort(p, "zh"), p.free ? "免费" : "", p.book ? "需预约" : ""].filter(Boolean).join(" · ");
}

function pickSheet(p: Pick, code: string, kindName: (k: string) => string): Sheet {
  const name = nameOf(p);
  const where = p.type === "place" ? p.district : venueOf(p);
  return {
    tone: "paper",
    tag: pickTag(p, kindName),
    title: name,
    lines: [
      name !== p.title ? `德语原名：${p.title}` : "",
      where ? `地点：${where}` : "",
      p.indoor === true ? "室内，下雨也能去" : p.indoor === false ? "户外" : "",
    ].filter(Boolean),
    note: textIn(p.why, "zh") || undefined,
    code,
    foot: "信息以主办方为准，出发前请再确认",
  };
}

/** One line per pick in the caption: "①【周六 10:00–15:00】MINTköln 科学日，Zentralbibliothek（免费）K31-2". */
function pickLine(p: Pick, i: number, code: string, kindName: (k: string) => string): string {
  const num = "①②③④⑤⑥⑦⑧⑨"[i] ?? `${i + 1}.`;
  const when = p.type === "place" ? "随时可去" : whenShort(p, "zh");
  const where = (p.type === "place" ? p.district : venueOf(p).split(",")[0])?.trim();
  const extra = [p.type === "place" && p.kind ? kindName(p.kind) : "", p.free ? "免费" : "", p.book ? "需预约" : ""].filter(Boolean).join("，");
  return `${num}【${when}】${nameOf(p)}${where ? `，${where}` : ""}${extra ? `（${extra}）` : ""} 编号${code}`;
}

/**
 * A town's weekly set from its weekend edition. `more`: the weekend's other family events and the town's
 * places, for the closing card. `codes`: each pick's code, when picks dropped out since it was published
 * (a code, once posted, must keep opening the same pick).
 */
export function weeklySet(ed: Edition, o: { townZh: string; kindName: (k: string) => string; more: { events: number; places: number }; codes?: string[] }): XhsSet {
  const sat = ed.weekend;
  const codes = o.codes ?? ed.picks.map((_, i) => codeOf(ed.slug, sat, i));
  const events = ed.picks.filter((p) => p.type === "event").length;
  const places = ed.picks.length - events;
  const weather = weatherLine(ed.weather, "zh");
  const holiday = ed.holiday ? (ed.holiday.last ? "学校假期最后一天" : "学校假期中") : "";
  const cover: Sheet = {
    tone: "gold",
    tag: `本周末 · ${o.townZh}`,
    title: `${o.townZh}带娃\n周末去哪`,
    lines: [
      `${md(sat)}（六）– ${md(addDays(sat, 1))}（日）`,
      weather ? `天气：${weather}` : "",
      holiday,
      [events ? `${events} 个活动` : "", places ? `${places} 个好去处` : ""].filter(Boolean).join("，"),
    ].filter(Boolean),
    foot: "每周五更新",
  };
  const end: Sheet = {
    tone: "ink",
    title: `还有 ${o.more.events} 个活动\n和 ${o.more.places} 个好去处`,
    lines: ["游乐场、室内乐园、农场、亲子咖啡馆，都有中文介绍"],
    search: "小鹿出游 Allo Outings",
    note: "在浏览器里搜索「小鹿出游 Allo Outings」，再在网站的搜索框输入卡片右下角的编号，就能直接打开那个活动。",
    foot: "地点数据部分来自 © OpenStreetMap 贡献者",
  };
  const caption = [
    `${o.townZh}本周末带娃去哪儿，挑了 ${ed.picks.length} 个👇`,
    [`${md(sat)}（六）– ${md(addDays(sat, 1))}（日）`, weather ? `天气：${weather}` : ""].filter(Boolean).join(" · "),
    holiday,
    "",
    ...ed.picks.map((p, i) => pickLine(p, i, codes[i], o.kindName)),
    "",
    "活动信息以主办方为准，出发前请再确认～",
    `还有 ${o.more.events} 个活动和 ${o.more.places} 个带娃好去处：浏览器搜索「小鹿出游 Allo Outings」，在网站搜索框输入编号就能找到对应活动。`,
    "",
    hashtags(TAGS(o.townZh)),
  ];
  return {
    id: `${ed.slug}-${sat}`,
    title: weeklyTitle(o.townZh, sat),
    caption: caption.filter((l, i) => l !== "" || caption[i - 1] !== "").join("\n").replace(/\n{3,}/g, "\n\n"),
    sheets: [cover, ...ed.picks.map((p, i) => pickSheet(p, codes[i], o.kindName)), end],
  };
}

/** Pick codes of an edition and the page each opens, without the language: "termine/<id>/". */
export const codesOf = (ed: Edition, codes = ed.picks.map((_, i) => codeOf(ed.slug, ed.weekend, i))) =>
  Object.fromEntries(ed.picks.map((p, i) => [codes[i], `${p.type === "place" ? "orte" : "termine"}/${p.id}/`]));

// ---------- hand-written sets ----------

/** content/rednote/<id>.yaml */
/** `season`: a season id (content/seasons.yaml); the Chinese pages of its events offer the set to share. */
export interface SetFile { title: string; caption: string; tags?: string[]; until?: string; season?: string; cards: Sheet[] }

export function fileSet(id: string, f: SetFile): XhsSet {
  return { id, title: f.title, caption: [f.caption.trim(), "", hashtags(f.tags ?? [])].join("\n").trim(), sheets: f.cards };
}

/** Problems with a set file, so a typo fails the tests rather than drawing a broken card. */
export function checkSetFile(f: SetFile): string[] {
  const out: string[] = [];
  if ([...(f.title ?? "")].length > 20) out.push(`title has ${[...f.title].length} characters; Rednote allows 20`);
  if (!f.caption?.trim()) out.push("caption is empty");
  if (/https?:|www\.|\.de\b|\.com\b|allo\.land/i.test(`${f.caption} ${JSON.stringify(f.cards)}`)) out.push("contains a link; Rednote punishes those");
  if (!f.cards?.length || f.cards.length > 18) out.push("needs 1 to 18 cards");
  for (const [i, c] of (f.cards ?? []).entries()) {
    if (!["gold", "paper", "ink"].includes(c.tone)) out.push(`card ${i + 1}: tone must be gold, paper or ink`);
    if (!c.title) out.push(`card ${i + 1}: no title`);
  }
  return out;
}
