// The weekly "This weekend" edition: five events and one place per town, picked every Thursday night by
// scripts/weekend-edition.mjs, published Friday, and shown at /<lang>/wochenende/<town>/.
// Everything here is plain logic (no files, no network), shared by the script, the pages and the
// Telegram post, so the page, the copy texts and the post always say the same thing.
// Plain TypeScript without enums or other non-erasable syntax, so Node runs it directly.

export type L = "de" | "en" | "zh";
export type Texts = { de: string; en?: string; zh?: string };

/** Towns that get an edition. One with fewer than MIN_EVENTS family events that weekend skips a week. */
export const WEEKEND_TOWNS = ["Köln", "Bonn", "Düsseldorf", "Berlin", "München", "Frankfurt am Main", "Hamburg"];

/**
 * Each town's public Telegram channel, by town slug, e.g. { koeln: "@littleoutings_koeln" }. The bot behind
 * TELEGRAM_BOT_TOKEN must be an admin of the channel. Empty: no channel button, nothing is posted.
 */
export const TELEGRAM: Record<string, string> = {};
export const telegramChannel = (slug: string): string | undefined => TELEGRAM[slug] || undefined;

export const PICKS = 5; // events (or places standing in for them) per edition
export const MIN_EVENTS = 3; // fewer family events than this and the town skips a week
export const SHORTLIST = 30; // candidates the AI chooses from
export const LONG_RUN = 7; // days: events running longer go into "Still on" instead of a pick
export const RECENT_EVENTS = 6; // editions: a title featured this recently scores down
export const RECENT_PLACES = 12; // editions: a place featured this recently is skipped

/** One pick (or alternate) as the edition stores it: enough to write the messages without the site's data. */
export interface Pick {
  id: string;
  type: "event" | "place";
  title: string;
  venue?: string;
  district?: string;
  /** Weekend days it is on (Fri only from 14:00), YYYY-MM-DD. Places: empty. */
  days: string[];
  time?: string;
  free?: boolean;
  price?: string;
  /** Registration needed ("Anmeldung"). */
  book?: boolean;
  indoor?: boolean;
  tags?: string[];
  kind?: string;
  hours?: string;
  score?: number;
  /** Short name per language, and one line on why it's a good pick. Written by the AI; title otherwise. */
  label?: Texts;
  why?: Texts;
}

export interface Weather { day: string; code: number; max: number; rain: number }

export interface Edition {
  town: string;
  slug: string;
  /** The Saturday, YYYY-MM-DD. */
  weekend: string;
  week: number;
  published_at: string;
  /** "ai" when the AI chose, "score" when the plain score did, "admin" when someone swapped a pick. */
  by: string;
  weather?: Weather[];
  /** School holidays on that weekend, and whether Saturday or Sunday is their last day. */
  holiday?: { name: string; last: boolean };
  picks: Pick[];
  still?: { id: string; title: string; venue?: string; end: string }[];
}

/** The draft the admin's "Weekend" panel shows and edits (little-outings/weekend.json in the bucket). */
export interface Draft {
  weekend: string;
  drafted_at: string;
  edited_at?: string;
  edited_by?: string;
  towns: Record<string, { picks: Pick[]; alternates: Pick[]; still?: Edition["still"]; weather?: Weather[]; by: string }>;
}

// ---------- dates ----------

const DAY = 864e5;
const at = (d: string) => Date.parse(`${d}T12:00:00Z`);
export const addDays = (d: string, n: number) => new Date(at(d) + n * DAY).toISOString().slice(0, 10);
/** 0 = Sunday … 6 = Saturday. */
export const dow = (d: string) => new Date(at(d)).getUTCDay();

/** The Saturday of the weekend a day belongs to: the coming one from Monday to Friday. */
export function weekendOf(today: string): string {
  const w = dow(today);
  return w === 0 ? addDays(today, -1) : addDays(today, 6 - w);
}

/** ISO calendar week ("KW 44"). */
export function isoWeek(d: string): number {
  const t = new Date(at(d));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((+t - +jan4) / DAY - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

/** "koeln", "duesseldorf", "muenchen": the town's part of the address. */
// Short names where the town's own is long: /w/frankfurt reads better than /w/frankfurt-am-main.
const SLUGS: Record<string, string> = { "Frankfurt am Main": "frankfurt" };
export const townSlug = (name: string) => SLUGS[name] ??
  name.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** "10:15", "10 bis 15 Uhr", "10:00–11:30" → "10:00" or "10:00–15:00"; undefined without a clock time. */
export function clockText(time?: string): string | undefined {
  if (!time) return undefined;
  const t = [...time.matchAll(/\b(\d{1,2})(?::(\d{2}))?(?=\s*(?:Uhr|–|-|bis|$))/g)]
    .map((m) => `${m[1].padStart(2, "0")}:${m[2] ?? "00"}`)
    .filter((x) => Number(x.slice(0, 2)) < 24);
  if (!t.length || t[0] === "00:00") return undefined;
  return t[1] && t[1] !== t[0] ? `${t[0]}–${t[1]}` : t[0];
}
const startHour = (time?: string) => { const c = clockText(time); return c ? Number(c.slice(0, 2)) : undefined; };

// ---------- opening hours ----------

const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function daySet(spec: string): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [a, b] = part.trim().split("-").map((s) => DOW.indexOf(s.trim()));
    if (a < 0) continue;
    if (b == null || b < 0) { out.add(a); continue; }
    for (let i = a; ; i = (i + 1) % 7) { out.add(i); if (i === b) break; }
  }
  return out;
}

function inMonths(spec: string, month: number): boolean {
  return spec.split(",").some((part) => {
    const [a, b] = part.trim().split("-").map((s) => MON.indexOf(s.trim().slice(0, 3)));
    if (a < 0) return true;
    if (b == null || b < 0) return month === a;
    return a <= b ? month >= a && month <= b : month >= a || month <= b;
  });
}

/**
 * Whether OSM opening hours say the place is open on Saturday and on Sunday in a given month (0–11).
 * Covers the common forms ("Mo-Su 09:00-18:00", "Tu-Su …; Mo off", "Mar-Oct: …; Nov-Feb: …", "24/7").
 * Unknown (no hours, or a form it can't read) is null.
 */
export function openOnWeekend(hours: string | undefined, month: number): { sat: boolean; sun: boolean } | null {
  if (!hours) return null;
  const h = hours.trim();
  if (/^24\/7$/.test(h)) return { sat: true, sun: true };
  const open = new Set<number>();
  let understood = false;
  // Rules end at ";", or at a comma after a time when the next one starts with days ("Mo-Fr 09:00-18:30, Sa 09:00-13:00").
  for (const raw of h.split(/;|(?<=\d\d:\d\d)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b)/)) {
    let rule = raw.trim().replace(/\bPH\b[^,;]*,?/g, "").trim();
    if (!rule) continue;
    const mon = rule.match(/^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:\s*-\s*\w+)?(?:\s*,\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:\s*-\s*\w+)?)*)\s*:?\s*/);
    if (mon) {
      if (!inMonths(mon[1], month)) { understood = true; continue; }
      rule = rule.slice(mon[0].length);
    }
    const dm = rule.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*[-,]\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))*)\s*/);
    const days = dm ? daySet(dm[1]) : new Set([0, 1, 2, 3, 4, 5, 6]);
    const rest = dm ? rule.slice(dm[0].length) : rule;
    if (/^(off|closed)\b/i.test(rest)) { days.forEach((d) => open.delete(d)); understood = true; continue; }
    if (/\d{1,2}:\d{2}/.test(rest)) { days.forEach((d) => open.add(d)); understood = true; }
  }
  return understood ? { sat: open.has(6), sun: open.has(0) } : null;
}

// ---------- events: scoring ----------

// Made for children: the strongest single sign.
const KID = /kinder|kind\b|kids|famili|eltern-kind|baby|kleinkind|krabbel|vorles|bilderbuch|puppe|kasper|m(ä|ae)rchen|mitmach|bastel|ab \d+ jahr|\d+\s*[-–]\s*\d+\s*jahr|j(ü|ue)nger|sch(ü|ue)ler|ferien|laterne|martin|lego|zirkus|zauber/i;
/** Whether a title says it's made for children or families. */
export const madeForKids = (title: string) => KID.test(title);
// Grown-up concerts and shows that the generous nightly sort lets through.
const ADULT = /\btour\b|\bsupport:|premiere|lesung|vortrag|sinfonie|symphon|staatskapelle|recital|kabarett|comedy|\bü\s?\d\d|\b1[68]\+/i;
const BIG_VENUE = /arena|palladium|e-werk|carlswerk|artheater|tanzbrunnen|live music hall|gloria|kantine|stadthalle|club\b|\bbar\b|oper\b|philharmonie|theater am tanzbrunnen/i;
const KID_SOURCE = /kind|famil|jugend|bibliothek|b(ü|ue)cherei|zoo|tierpark|museum|farm|hof/i;
const INSIDE = /bibliothek|b(ü|ue)cherei|museum|theater|kino|halle|haus|zentrum|schule|kirche|planetarium|bad\b|aquarium/i;
const OUTSIDE_TAGS = ["outside", "market", "fest", "animals"];

/** Indoors (true), outdoors (false) or unknown, from the title, venue and event types. */
export function indoorOf(title: string, venue = "", tags: string[] = []): boolean | undefined {
  if (tags.includes("outside") || /drau(ß|ss)en|wald|spaziergang|wanderung|im park|open.?air|garten|hof\b|markt/i.test(`${title} ${venue}`)) return false;
  if (INSIDE.test(venue) || tags.some((g) => ["reading", "stage", "tour"].includes(g))) return true;
  if (tags.some((g) => OUTSIDE_TAGS.includes(g))) return false;
  return undefined;
}

/** First number in a price text, in euros; undefined when free or unreadable. */
function priceOf(text?: string): number | undefined {
  if (!text || /kostenlos|frei\b|gratis|free/i.test(text)) return undefined;
  const m = text.match(/(\d+)(?:[.,](\d{1,2}))?/);
  return m ? Number(`${m[1]}.${m[2] ?? 0}`) : undefined;
}

/**
 * How well an event suits the weekend edition: made for children, free, daytime, the right roof for
 * the weather, not a grown-up concert, not featured lately. Higher is better; below 1 it's not a pick.
 */
export function scoreEvent(p: Pick, o: { source?: string; rain?: boolean; dry?: boolean; recent?: Set<string> } = {}): number {
  const text = `${p.title} ${p.venue ?? ""}`;
  const kid = KID.test(p.title);
  let s = 0;
  if (kid) s += 3;
  if ((p.tags ?? []).some((g) => ["reading", "diy", "animals", "season", "fest", "market"].includes(g))) s += 2;
  if ((p.tags ?? []).includes("stage") && kid) s += 1;
  if (o.source && KID_SOURCE.test(o.source)) s += 1;
  if (p.free) s += 1;
  const h = startHour(p.time);
  if (h != null && h >= 9 && h <= 16) s += 1;
  if (h != null && h >= 18) s -= 2;
  const euros = priceOf(p.price);
  if (euros != null && euros > 25) s -= 2;
  if (!kid && BIG_VENUE.test(p.venue ?? "")) s -= 3;
  if (!kid && ADULT.test(text)) s -= 3;
  if ((p.tags ?? []).some((g) => g === "parents" || g === "learn")) s -= 3;
  if (o.rain) s += p.indoor === true ? 1 : p.indoor === false ? -2 : 0;
  if (o.dry && p.indoor === false) s += 1;
  if (o.recent?.has(recentKey(p))) s -= 2;
  return s;
}

export const recentKey = (p: Pick) => `${p.title.toLowerCase()}|${(p.venue ?? "").split(",")[0].toLowerCase()}`;

/**
 * Five picks that mix well, best score first: one venue and title only once, at most two at the same hour,
 * at most one on Friday afternoon,
 * Saturday and Sunday both covered when possible, and mostly indoors when it rains.
 */
export function pickMix(cands: Pick[], o: { n?: number; rain?: boolean; sat: string; sun: string }): Pick[] {
  const n = o.n ?? PICKS;
  const sorted = [...cands].filter((c) => (c.score ?? 0) >= 1).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const venue = (p: Pick) => (p.venue ?? p.id).split(",")[0].toLowerCase();
  // Events without a time don't count toward "the same hour".
  const slot = (p: Pick) => { const c = clockText(p.time); return c ? `${p.days[0]}|${c.slice(0, 2)}` : `${p.id}|?`; };
  const title = (p: Pick) => p.title.toLowerCase();
  // Friday afternoon is a bonus: one pick at most.
  const friday = (p: Pick) => !p.days.some((d) => d >= o.sat);
  const fits = (p: Pick, chosen: Pick[]) =>
    !chosen.some((c) => venue(c) === venue(p) || title(c) === title(p)) && chosen.filter((c) => slot(c) === slot(p)).length < 2
    && !(friday(p) && chosen.some(friday));
  const out: Pick[] = [];
  for (const p of sorted) if (out.length < n && fits(p, out)) out.push(p);
  // Make sure both days are there: swap the weakest pick for the best one on the missing day.
  for (const day of [o.sat, o.sun]) {
    if (out.some((p) => p.days.includes(day))) continue;
    const alt = sorted.find((p) => p.days.includes(day) && !out.includes(p) && fits(p, out.slice(0, -1)));
    if (alt && out.length) out[out.length - 1] = alt;
    else if (alt) out.push(alt);
  }
  if (o.rain) {
    // At least three under a roof when rain is forecast, as far as the shortlist allows.
    for (let i = out.length - 1; i >= 0 && out.filter((p) => p.indoor === true).length < 3; i--) {
      if (out[i].indoor === true) continue;
      const alt = sorted.find((p) => p.indoor === true && !out.includes(p) && fits(p, out.filter((_, j) => j !== i)));
      if (alt) out[i] = alt;
    }
  }
  return out.sort(byWhen);
}

/** Saturday before Sunday, morning before afternoon; places last. */
export function byWhen(a: Pick, b: Pick): number {
  if (a.type !== b.type) return a.type === "event" ? -1 : 1;
  return (a.days[0] ?? "").localeCompare(b.days[0] ?? "") || (clockText(a.time) ?? "99").localeCompare(clockText(b.time) ?? "99");
}

// ---------- places ----------

// Kinds that suit the weather; a zoo only counts as the zoo itself, not each enclosure OSM maps inside it.
const RAIN_KINDS = ["indoor", "pool", "museum", "fun", "zoo"];
const DRY_KINDS = ["farm", "zoo", "park", "playground", "fun"];
const ZOO_NAME = /zoo|tierpark|wildpark|tiergehege|wildgehege|vogelpark|tiergarten|aquazoo/i;
// OSM's farms are mostly farm shops and seasonal stalls (asparagus, strawberries): only the ones
// made for a visit with children count. Animal corners of care homes are tagged as zoos too.
const FARM_VISIT = /kinderbauernhof|jugendfarm|kinderfarm|erlebnis|streichel|ponyhof|abenteuer|lernbauernhof/i;
const NOT_FOR_VISITORS = /senior|pflege/i;

export interface OsmRow { osm: string; kind: string; name?: string; town: string; hours?: string; free?: boolean; indoor?: boolean; facilities?: string[]; street?: string; nearby?: { road?: string; district?: string } }

/**
 * The place that's always a good idea this weekend: the right kind for the weather, open on Saturday or
 * Sunday by its OSM hours, not featured lately. Playgrounds and parks have no hours, so they count as open.
 */
export function placeCandidates(rows: OsmRow[], o: { town: string; month: number; rain?: boolean; recent?: Set<string>; hidden?: Set<string> }): Pick[] {
  const kinds = o.rain ? RAIN_KINDS : DRY_KINDS;
  const out: Pick[] = [];
  for (const r of rows) {
    if (r.town !== o.town || !r.name || !kinds.includes(r.kind)) continue;
    const id = `osm-${r.osm.replace("/", "-")}`;
    if (o.hidden?.has(id) || o.recent?.has(id)) continue;
    if (r.kind === "zoo" && !ZOO_NAME.test(r.name)) continue;
    if ((r.kind === "farm" && !FARM_VISIT.test(r.name)) || NOT_FOR_VISITORS.test(r.name)) continue;
    const open = openOnWeekend(r.hours, o.month);
    const needsHours = !["park", "playground"].includes(r.kind);
    if (needsHours ? !open || !(open.sat || open.sun) : open && !(open.sat || open.sun)) continue;
    const facilities = r.facilities ?? [];
    // Rank: the weather's first-choice kinds first, then free, then places with more to do.
    const score = (kinds.length - kinds.indexOf(r.kind)) + (r.free ? 2 : 0) + Math.min(facilities.length, 4) / 2
      + (r.kind === "playground" ? -2 : 0);
    out.push({
      id, type: "place", title: r.name, kind: r.kind, hours: r.hours, free: r.free, indoor: r.indoor ?? (["indoor", "pool", "museum"].includes(r.kind) || undefined),
      district: r.nearby?.district, venue: r.street ?? r.nearby?.road, days: [], score,
    });
  }
  return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.id.localeCompare(b.id));
}

// ---------- weather ----------

export const isRainy = (w?: Weather) => !!w && (w.rain >= 60 || (w.code >= 51 && w.code <= 67) || (w.code >= 80 && w.code <= 82) || w.code >= 95);
export const isDry = (w?: Weather) => !!w && w.rain < 30 && w.code < 51;

const SKY: Record<L, [number, string][]> = {
  de: [[3, "sonnig"], [4, "bewölkt"], [49, "neblig"], [67, "Regen"], [77, "Schnee"], [82, "Schauer"], [86, "Schnee"], [99, "Gewitter"]],
  en: [[3, "sunny"], [4, "cloudy"], [49, "fog"], [67, "rain"], [77, "snow"], [82, "showers"], [86, "snow"], [99, "thunder"]],
  zh: [[3, "晴"], [4, "多云"], [49, "有雾"], [67, "有雨"], [77, "有雪"], [82, "阵雨"], [86, "有雪"], [99, "雷雨"]],
};
/** "sonnig", "Schauer"; codes 0–2 are sunny or partly sunny, 3 overcast (WMO weather codes, Open-Meteo). */
export function skyWord(code: number, lang: L): string {
  const c = code <= 2 ? 0 : code === 3 ? 3.5 : code;
  return (SKY[lang].find(([max]) => c <= max) ?? SKY[lang][SKY[lang].length - 1])[1];
}

// ---------- messages ----------

const DAYS: Record<L, string[]> = {
  de: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  zh: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
};
const WORDS = {
  de: { more: "Und {n} weitere Termine fürs Wochenende:", head: "Wochenende mit Kindern in {town}", free: "frei", any: "Immer", book: "Anmeldung", all: "Alle Ideen", last: "Letzter Ferientag", holiday: "{name}" },
  en: { more: "And {n} more events this weekend:", head: "This weekend with kids in {town}", free: "free", any: "Any time", book: "book ahead", all: "All ideas", last: "Last day of the school holidays", holiday: "School holidays" },
  zh: { more: "本周末还有{n}个活动：", head: "本周末带孩子去哪儿 · {town}", free: "免费", any: "随时", book: "需预约", all: "全部推荐", last: "学校假期最后一天", holiday: "学校假期" },
} as const;

export const dayShort = (d: string, lang: L) => DAYS[lang][dow(d)];

/** "Sa 31.10. – So 1.11." / "Sat 31 Oct – Sun 1 Nov" / "10月31日（六）– 11月1日（日）". */
export function weekendRange(sat: string, lang: L): string {
  const sun = addDays(sat, 1);
  const [, m1, d1] = sat.split("-").map(Number), [, m2, d2] = sun.split("-").map(Number);
  if (lang === "zh") return `${m1}月${d1}日（六）– ${m2}月${d2}日（日）`;
  if (lang === "en") {
    const mon = (m: number) => MON[m - 1];
    return `Sat ${d1} ${mon(m1)} – Sun ${d2} ${mon(m2)}`;
  }
  return `Sa ${d1}.${m1}. – So ${d2}.${m2}.`;
}

export const textIn = (t: Texts | undefined, lang: L, fallback = "") => (t && (t[lang] || t.de)) || fallback;
const nameIn = (p: Pick, lang: L) => textIn(p.label, lang, p.title);
const venueShort = (p: Pick) => (p.venue ?? "").split(/,|\s+[–—-]\s+/)[0].trim();

/** "Sa 11:00", "Sa+So 10:00–15:00", "Immer" for places. */
export function whenShort(p: Pick, lang: L): string {
  if (p.type === "place") return WORDS[lang].any;
  const days = p.days.map((d) => dayShort(d, lang)).join(lang === "zh" ? "、" : "+");
  const time = clockText(p.time);
  return [days, time].filter(Boolean).join(" ");
}

/** The weather in one line: "Sa Schauer 13°, So sonnig 11°". */
export function weatherLine(w: Weather[] | undefined, lang: L): string {
  if (!w?.length) return "";
  return w.map((x) => `${dayShort(x.day, lang)} ${skyWord(x.code, lang)} ${Math.round(x.max)}°`).join(lang === "zh" ? "，" : ", ");
}

function holidayLine(ed: Edition, lang: L): string {
  if (!ed.holiday) return "";
  return ed.holiday.last ? WORDS[lang].last : lang === "de" ? ed.holiday.name : WORDS[lang].holiday;
}

/** One line per pick: when, name, venue, free / book ahead. */
function pickLine(p: Pick, lang: L, style: "whatsapp" | "wechat"): string {
  const when = whenShort(p, lang);
  const head = style === "wechat" ? `【${when}】` : `*${when}*`;
  const where = p.type === "place" ? p.district ?? "" : venueShort(p);
  const extra = [p.free ? WORDS[lang].free : "", p.book ? WORDS[lang].book : ""].filter(Boolean).join(", ");
  const open = lang === "zh" ? "（" : " (", close = lang === "zh" ? "）" : ")";
  const sep = lang === "zh" ? "，" : ", ";
  const name = nameIn(p, lang);
  const gap = style === "wechat" ? "" : " ";
  return `${head}${gap}${name}${where && !name.includes(where) ? sep + where : ""}${extra ? open + extra + close : ""}`;
}

/**
 * The text parents copy into a chat. WhatsApp shows *bold*; WeChat shows asterisks as they are, so
 * its version marks the days with 【】 instead. The link comes last so the chat shows its preview.
 */
const BRAND: Record<L, string> = { de: "Allo Outings", en: "Allo Outings", zh: "小鹿出游" };

export function chatText(ed: Edition, o: { lang: L; style: "whatsapp" | "wechat"; town: string; url: string; more?: number }): string {
  const w = WORDS[o.lang];
  const title = w.head.replace("{town}", o.town);
  const lines = [
    // The name up front, so a forwarded text still says where it came from (and what to search for).
    o.style === "wechat" ? `【${title}】${BRAND[o.lang]}` : `*${title}* · ${BRAND[o.lang]}`,
    [weekendRange(ed.weekend, o.lang), weatherLine(ed.weather, o.lang)].filter(Boolean).join(" · "),
    holidayLine(ed, o.lang),
    "",
    ...ed.picks.map((p) => pickLine(p, o.lang, o.style)),
    "",
    o.more ? `${w.more.replace("{n}", String(o.more))} 👉 ${o.url}` : `👉 ${o.url}`,
  ];
  return lines.filter((l, i) => l !== "" || (i > 0 && lines[i - 1] !== "")).join("\n").replace(/\n{3,}/g, "\n\n");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The Telegram channel post (Bot API, parse_mode HTML): days as headings, each title linked to its page. */
export function telegramText(ed: Edition, o: { lang: L; town: string; url: string; site: string }): string {
  const w = WORDS[o.lang];
  const link = (p: Pick) => `<a href="${esc(`${o.site}/${o.lang}/${p.type === "place" ? "orte" : "termine"}/${p.id}/`)}">${esc(nameIn(p, o.lang))}</a>`;
  const extra = (p: Pick) => [p.free ? w.free : "", p.book ? w.book : ""].filter(Boolean).join(", ");
  const line = (p: Pick) => {
    const when = p.type === "place" ? "" : `${clockText(p.time) ?? ""}`;
    const where = p.type === "place" ? "" : venueShort(p);
    return [when, link(p) + (where && !nameIn(p, o.lang).includes(where) ? `, ${esc(where)}` : ""), extra(p)].filter(Boolean).join(" · ");
  };
  const out = [`<b>${esc(w.head.replace("{town}", o.town))}</b>`, [weekendRange(ed.weekend, o.lang), weatherLine(ed.weather, o.lang)].filter(Boolean).join(" · ")];
  const hol = holidayLine(ed, o.lang);
  if (hol) out.push(esc(hol));
  const events = ed.picks.filter((p) => p.type === "event");
  for (const day of [addDays(ed.weekend, -1), ed.weekend, addDays(ed.weekend, 1)]) {
    const on = events.filter((p) => p.days[0] === day);
    if (!on.length) continue;
    const name = new Intl.DateTimeFormat(o.lang === "zh" ? "zh-CN" : o.lang === "en" ? "en-GB" : "de-DE", { weekday: "long", timeZone: "UTC" }).format(new Date(at(day)));
    out.push("", `<b>${esc(name)}</b>`, ...on.map(line));
  }
  const places = ed.picks.filter((p) => p.type === "place");
  if (places.length) out.push("", `<b>${esc(o.lang === "de" ? "Immer offen" : o.lang === "en" ? "Open any time" : "随时可去")}</b>`, ...places.map(line));
  out.push("", `${w.all}: ${esc(o.url)}`);
  return out.join("\n");
}

// ---------- the AI's choice ----------

export const PICK_PROMPT = `You choose the weekly "This weekend" picks for Allo Outings, a website where parents in Germany find outings with their children.
You get the weekend's weather, whether it is a school holiday, and a numbered shortlist of events (German titles) with day, time, venue, district, price and hints.
Choose exactly {n} events a family with young children would most enjoy, with a good mix:
- made for children or families first; never grown-up concerts, talks or courses
- at least one on Saturday and one on Sunday, at least two free if possible
- one venue only once, different parts of town, something for under-4s if there is one
- if rain is likely, mostly indoors; if it is dry, something outdoors
For each pick write a short name (at most 40 characters; keep German proper names, translate what the event is) and one friendly line (at most 90 characters) saying why it's a good pick, each in German (de), English (en) and Simplified Chinese (zh). Don't invent facts that aren't in the list.
Return only JSON: {"picks": [{"i": 0, "label": {"de": "", "en": "", "zh": ""}, "why": {"de": "", "en": "", "zh": ""}}]}`;

export const PLACE_PROMPT = `You write for Allo Outings, a website where parents in Germany find outings with their children.
For each numbered place or event, write a short name (at most 40 characters; keep German proper names) and one friendly line (at most 90 characters) on why a family might go this weekend, in German (de), English (en) and Simplified Chinese (zh). Use only the facts given. When a line ends with "say:", use that German sentence and translate it.
Return only JSON: {"items": [{"i": 0, "label": {"de": "", "en": "", "zh": ""}, "why": {"de": "", "en": "", "zh": ""}}]}`;

/** One shortlist line for the AI. */
export function describe(p: Pick, i: number): string {
  const facts = [
    p.type === "place" ? `place: ${p.kind}` : p.days.map((d) => dayShort(d, "en")).join("+"),
    clockText(p.time), p.venue, p.district, p.free ? "free" : p.price, p.book ? "registration needed" : "",
    p.indoor === true ? "indoors" : p.indoor === false ? "outdoors" : "", p.hours ? `hours ${p.hours}` : "",
  ].filter(Boolean);
  return `${i}. ${p.title} | ${facts.join(" | ")}`;
}

const cleanTexts = (x: any, max: number): Texts | undefined => {
  if (!x || typeof x.de !== "string" || !x.de.trim()) return undefined;
  const cut = (s: unknown) => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : undefined);
  return { de: cut(x.de)!, ...(cut(x.en) && { en: cut(x.en) }), ...(cut(x.zh) && { zh: cut(x.zh) }) };
};

/** The AI's answer → [index, label, why], dropping anything malformed, duplicate or out of range. */
export function parsePicks(text: string, size: number, key = "picks"): { i: number; label?: Texts; why?: Texts }[] {
  let body: any;
  try { body = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return []; }
  const seen = new Set<number>();
  return (Array.isArray(body?.[key]) ? body[key] : []).flatMap((x: any) => {
    const i = Number(x?.i);
    if (!Number.isInteger(i) || i < 0 || i >= size || seen.has(i)) return [];
    seen.add(i);
    return [{ i, label: cleanTexts(x.label, 60), why: cleanTexts(x.why, 140) }];
  });
}
