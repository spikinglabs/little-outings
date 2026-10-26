// Rednote (小红书) picture sets, for the Chinese-speaking parents in Germany who plan outings there.
// Rednote punishes links and QR codes (in notes, comments and the profile), so every card carries the
// whole story: name, day, time, place, price. The bridge to the site is the name 小出游 and a short code
// per pick (src/lib/rednote-code.ts) that the site's search box opens.
//
// Nothing is posted from here: Rednote has no posting API, and bots that post anyway get accounts
// banned. The build draws the cards (src/pages/xhs/), the admin's Rednote box shows them with the
// caption, and someone posts them by hand.
//
//   weekly   one set per town in REDNOTE_TOWNS from its weekend edition: cover, one card per pick, closing card
//   sets     hand-written explainers in content/rednote/<id>.yaml (St. Martin …), drawn until their `until` day
//
// Cards are 1080×1440 (3:4, what Rednote shows uncropped). Plain TypeScript, so tests run it in Node.
import { UI_ICON } from "./icons.ts";
import { textEm, wrap } from "./og.ts";
import { codeOf } from "./rednote-code.ts";
import { addDays, textIn, weatherLine, whenShort, type Edition, type Pick } from "./weekend.ts";

/** Towns whose weekend edition gets a Rednote set, by slug. Add one when someone posts for it. */
export const REDNOTE_TOWNS = ["koeln", "berlin"];

export const XHS = { w: 1080, h: 1440 } as const;

/** One card. `title` may hold "\n" to break it on purpose. */
export interface Sheet {
  tone: "gold" | "paper" | "ink";
  tag?: string;
  title: string;
  /** Lines under the title, each wrapped on its own. */
  lines?: string[];
  /** One sentence set apart below the lines: why it's a good pick. */
  note?: string;
  /** A search box picture with this text: how to find the site. */
  search?: string;
  code?: string;
  foot?: string;
}

/** A finished set: what the admin shows next to the pictures, ready to copy. */
export interface XhsSet { id: string; title: string; caption: string; sheets: Sheet[] }

// ---------- the weekly set ----------

const TAGS = (town: string) => ["德国带娃", `${town}带娃`, town, "周末去哪儿", "遛娃", "德国生活", "德国妈妈", "留德"];
const hashtags = (tags: string[]) => tags.map((t) => `#${t}`).join(" ");

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
    search: "小出游 Little Outings",
    note: "在浏览器里搜索小出游，再在网站的搜索框输入卡片右下角的编号，就能直接打开那个活动。",
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
    `还有 ${o.more.events} 个活动和 ${o.more.places} 个带娃好去处：浏览器搜索「小出游」，在网站搜索框输入编号就能找到对应活动。`,
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

// ---------- drawing ----------

const C = {
  gold: { bg: "#ffcc00", ink: "#17191b", soft: "#3d4146", tagBg: "#17191b", tagInk: "#ffcc00", rule: "#17191b" },
  paper: { bg: "#fbfaf6", ink: "#17191b", soft: "#4a4f55", tagBg: "#17191b", tagInk: "#ffcc00", rule: "#dddbd5" },
  ink: { bg: "#17191b", ink: "#ffffff", soft: "#c9cbcf", tagBg: "#ffcc00", tagInk: "#17191b", rule: "#3a3d41" },
} as const;
const BLAU = "#1d4f91";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const font = (s: string) => `font-family="${/[⺀-￯]/.test(s) ? "Noto Sans SC" : "Atkinson Hyperlegible"}"`;
const text = (x: number, y: number, s: string, size: number, fill: string, weight = 400, extra = "") =>
  `<text x="${x}" y="${y}" ${font(s)} font-size="${size}" font-weight="${weight}" fill="${fill}"${extra}>${esc(s)}</text>`;

// Chinese punctuation that may not start a line: it moves to the end of the line before.
const CLOSING = /^[，。、；：！？）」』》%]/;

/** wrap() from og.ts, keeping closing punctuation off the start of a line. */
export function lines(text: string, maxEm: number): string[] {
  const out = wrap(text, maxEm);
  for (let i = 1; i < out.length; i++) {
    while (CLOSING.test(out[i])) { out[i - 1] += out[i][0]; out[i] = out[i].slice(1); }
  }
  // No last line of one or two characters ("间。"): it takes two more Chinese characters from the line above.
  const n = out.length;
  if (n > 1 && [...out[n - 1].replace(/[，。、；：！？）」』》]/g, "")].length <= 2) {
    const prev = [...out[n - 2]];
    if (prev.length > 4 && prev.slice(-2).every((c) => /[\u4e00-\u9fff]/.test(c))) {
      out[n - 1] = prev.slice(-2).join("") + out[n - 1];
      out[n - 2] = prev.slice(0, -2).join("");
    }
  }
  return out.filter(Boolean);
}

/** The title's size and lines: the first [size, most lines] that fits; forced breaks ("\n") stay. */
export function fitTitle(title: string, width: number, sizes: [number, number][]): { size: number; lines: string[] } {
  const split = (size: number) => title.split("\n").flatMap((part) => lines(part, width / size));
  for (const [size, max] of sizes) {
    const l = split(size);
    if (l.length <= max && l.every((x) => textEm(x) * size <= width)) return { size, lines: l };
  }
  const [size, max] = sizes[sizes.length - 1];
  const l = split(size);
  return { size, lines: l.length > max ? [...l.slice(0, max - 1), `${l[max - 1]}…`] : l };
}

/** One card as SVG; `page` is "2/7". */
export function sheetSvg(s: Sheet, page?: string): string {
  const c = C[s.tone];
  const { w, h } = XHS;
  const x = 96, width = w - 2 * x;
  const out: string[] = [];
  let y = 150;
  if (page) out.push(text(w - x, 118, page, 30, c.soft, 700, ` text-anchor="end"`));
  if (s.tag) {
    const size = 38, tw = textEm(s.tag) * size * 1.08 + 60;
    out.push(`<rect x="${x}" y="${y}" width="${Math.min(tw, width)}" height="74" rx="10" fill="${c.tagBg}"/>`);
    out.push(text(x + 26, y + 50, s.tag, size, c.tagInk, 700));
    y += 74 + 70;
  } else y += 40;

  const cover = s.tone === "gold" && !s.code;
  const t = fitTitle(s.title, width, cover ? [[150, 2], [128, 3], [108, 3]] : [[96, 1], [84, 1], [72, 1], [84, 2], [72, 2], [62, 3], [62, 4]]);
  for (const l of t.lines) { y += t.size; out.push(text(x, y, l, t.size, c.ink, 700)); y += t.size * 0.22; }
  y += 40;

  const small = 46, lh = small * 1.45;
  for (const line of s.lines ?? []) {
    for (const l of lines(line, (width / small) * 0.96).slice(0, 3)) { y += lh; out.push(text(x, y, l, small, c.soft)); }
    y += 10;
  }
  if (s.search) {
    y += 50;
    const size = 52;
    out.push(`<rect x="${x}" y="${y}" width="${width}" height="116" rx="58" fill="#ffffff"/>`);
    out.push(`<circle cx="${x + 70}" cy="${y + 52}" r="20" fill="none" stroke="#5b6066" stroke-width="7"/><line x1="${x + 85}" y1="${y + 67}" x2="${x + 102}" y2="${y + 84}" stroke="#5b6066" stroke-width="7" stroke-linecap="round"/>`);
    out.push(text(x + 136, y + 76, s.search, size, "#17191b", 700));
    y += 116;
  }
  if (s.note) {
    y += 46;
    out.push(`<rect x="${x}" y="${y}" width="${width}" height="4" fill="${c.rule}"/>`);
    y += 20;
    const size = 50;
    for (const l of lines(s.note, (width / size) * 0.96).slice(0, 5)) { y += size * 1.45; out.push(text(x, y, l, size, c.ink)); }
  }

  // Bottom: the brand on the left, the code on the right, the small print above them.
  const base = h - 96;
  if (s.foot) out.push(text(x, base - 92, s.foot, 30, c.soft));
  out.push(`<rect x="${x}" y="${base - 50}" width="60" height="60" rx="12" fill="${s.tone === "gold" ? "#ffffff" : "#ffcc00"}" stroke="#17191b" stroke-width="4"/>`);
  out.push(`<g transform="translate(${x + 11} ${base - 39}) scale(${38 / 24})" fill="none" stroke="#17191b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${UI_ICON.brand}</g>`);
  out.push(text(x + 84, base - 4, "小出游 Little Outings", 44, c.ink, 700));
  if (s.code) {
    const size = 56, cw = textEm(s.code) * size * 0.82 + 56;
    out.push(`<rect x="${w - x - cw}" y="${base - 66}" width="${cw}" height="88" rx="10" fill="${BLAU}"/>`);
    out.push(`<text x="${w - x - cw / 2}" y="${base - 2}" font-family="Barlow Semi Condensed" font-size="${size}" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="2">${esc(s.code)}</text>`);
  }
  const stripe = `<rect width="${w}" height="12" fill="#17191b"/><rect y="12" width="${w}" height="12" fill="#d1001f"/><rect y="24" width="${w}" height="12" fill="#ffcc00"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${c.bg}"/>${stripe}${out.join("")}</svg>`;
}
