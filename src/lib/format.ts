import type { Lang, T, Text } from "./i18n";
import type { Event, Item } from "./types";

type TownRec = { name: string; zh?: string; en?: string };

/** Town names in the reader's language, from the region file (e.g. Köln → Cologne / 科隆). */
export const townName = (name: string | undefined, lang: Lang, towns: TownRec[]) => {
  if (!name) return "";
  const t = towns.find((x) => x.name === name);
  return (lang !== "de" && t?.[lang]) || name;
};

// Same as tr() in i18n.ts, which can't be imported here: it loads the UI strings through Vite.
const text = (v: Text, lang: Lang) => (typeof v === "string" ? v : v[lang] || v.de);

/** An event's title or a place's name in the reader's language, machine translations included. */
export const nameOf = (x: Item, lang: Lang) =>
  x.type === "event" ? text(x.title, lang) : (lang === "zh" && x.names?.zh) || x.name;

/** The German original when nameOf shows a machine translation, so parents can match signs and posters. */
export function germanName(x: Item, lang: Lang): string | undefined {
  if (x.type === "event") return x.machine?.includes(lang as "zh") ? text(x.title, "de") : undefined;
  return lang === "zh" && x.names?.zh ? x.name : undefined;
}

/** How many answers parents gave about a place: facility votes, "We went" and approved tips. */
export function parentInput(x: Item): number {
  if (x.type !== "place") return 0;
  const votes = Object.values(x.facilities).reduce((n, f) => n + (f.votes ? f.votes.yes + f.votes.no : 0), 0);
  return votes + (x.visits?.count ?? 0) + (x.tips?.length ?? 0);
}

const date = (d: string) => new Date(`${d}T12:00:00Z`);
const fmt = (t: T, d: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(t.locale, { timeZone: "UTC", ...opts }).format(date(d));

/** The three lines of the gold date sign: weekday, day, month. */
export function stampParts(t: T, d: string) {
  const dt = date(d);
  return {
    dow: fmt(t, d, { weekday: "short" }).replace(".", ""),
    day: String(dt.getUTCDate()),
    mon: t.lang === "zh" ? `${dt.getUTCMonth() + 1}月` : fmt(t, d, { month: "short" }).replace(".", ""),
  };
}

export const longDate = (t: T, d: string) => fmt(t, d, { weekday: "long", day: "numeric", month: "long" });

export function dateRange(t: T, e: Event) {
  if (e.end === e.start) return longDate(t, e.start);
  const short = (d: string) => fmt(t, d, { day: "numeric", month: "short" });
  return `${short(e.start)} – ${short(e.end)}`;
}

export function ageText(t: T, ages?: [number, number]) {
  if (!ages) return "";
  return ages[0] === 0 && ages[1] >= 12 ? t("allAges") : t("years", { a: ages[0], b: ages[1] });
}

export const pathFor = (lang: Lang, item: Pick<Item, "type" | "id">) =>
  `/${lang}/${item.type === "place" ? "orte" : "termine"}/${item.id}/`;

export const isFree = (x: Item) => (x.type === "place" ? !!x.free : !!x.price?.free);

// Farm words in German and English. "Gut" only counts as an estate name ("Gut Hixholz"), not the adjective.
const FARM = /bauernhof|erlebnishof|reiterhof|ponyhof|hofladen|hoffest|hofcaf|bauernmarkt|landwirt|\bfarm|\bhof\b/i;
const ESTATE = /\bGut [A-ZÄÖÜ]/;
/** A farm place, an event at one, or an event whose title, venue or source names a farm or Hof. */
export function isFarm(x: Item, place?: Item): boolean {
  if (x.type === "place") return x.kind === "farm";
  if (place?.type === "place" && place.kind === "farm") return true;
  const text = [x.title, x.venue, x.trust.source]
    .flatMap((v) => (v == null ? [] : typeof v === "string" ? [v] : Object.values(v)))
    .join(" | ");
  return FARM.test(text) || ESTATE.test(text);
}

/** Compact date for small signs: "Sa 11. Okt", "Sat 11 Oct", "10月11日 周六". */
export function shortDate(t: T, d: string) {
  const p = stampParts(t, d);
  if (t.lang === "zh") return `${p.mon}${p.day}日 ${p.dow}`;
  return `${p.dow} ${p.day}${t.lang === "de" ? "." : ""} ${p.mon}`;
}
