// Event times and opening hours in the reader's language.
//
// Sources write times in German: "10:30 bis 11:15 Uhr", "Täglich 11–21, Fr–Sa 11–22 Uhr; Totensonntag (22.11.) zu".
// Most follow a handful of patterns, so localTime() rewrites those by rule. Anything with words the rules don't
// know ("Vernissage: 7. November …") is left to the nightly translation job (scripts/translate.mjs), whose
// answers come back as a cache keyed by the German text.

export type TimeLang = "en" | "zh";

const DAYS: Record<string, [string, string]> = {
  mo: ["Mon", "周一"], di: ["Tue", "周二"], mi: ["Wed", "周三"], do: ["Thu", "周四"], fr: ["Fri", "周五"], sa: ["Sat", "周六"], so: ["Sun", "周日"],
};
const FULL_DAYS: Record<string, string> = {
  montag: "mo", dienstag: "di", mittwoch: "mi", donnerstag: "do", freitag: "fr", samstag: "sa", sonnabend: "sa", sonntag: "so",
};
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Every word the rules understand. A time with any other word goes to the translation cache instead. */
const KNOWN = new Set([
  "uhr", "bis", "von", "ab", "und", "zu", "täglich", "abmarsch", "totensonntag", "stand", "jeden", "ersten", "im", "monat",
  "floating", "timezone", "unspecified", "all", "day", "zeiten", "noch", "nicht", "bekannt", "geschlossen", "beginn", "einlass", "ca",
  ...Object.keys(DAYS), ...Object.keys(FULL_DAYS), ...Object.keys(FULL_DAYS).map((d) => `${d}s`),
]);

/** Whether the rules can rewrite this time completely. */
export function ruleKnows(time: string): boolean {
  const words = time.toLowerCase().match(/[a-zäöüß]+/g) ?? [];
  return words.every((w) => KNOWN.has(w));
}

const pad = (c: string) => (c.includes(":") ? c.replace(/^(\d):/, "0$1:") : `${c.padStart(2, "0")}:00`);
const day = (d: string, lang: TimeLang) => DAYS[d.toLowerCase()][lang === "en" ? 0 : 1];
const date = (d: string, m: string, lang: TimeLang) => (lang === "en" ? `${+d} ${MONTHS_EN[+m - 1]}` : `${+m}月${+d}日`);

/**
 * The time in English or Chinese, or undefined when it shouldn't be shown (00:00, which sources use for "no time").
 * A time the rules can't fully read comes from `cache` (German → translation), or stays German.
 */
export function localTime(time: string | undefined, lang: TimeLang, cache: Record<string, string> = {}): string | undefined {
  if (!time) return undefined;
  const s = time.trim();
  if (/^0?0:00(:00)?(\s*Uhr)?$/.test(s)) return undefined;
  if (!ruleKnows(s)) return cache[s] || s;
  const zh = lang === "zh";
  let t = s;
  if (/^all day$/i.test(t) || /^0?0:00\s*[–-]\s*23:59$/.test(t)) return zh ? "全天" : "All day";
  if (/^zeiten noch nicht bekannt$/i.test(t)) return zh ? "时间待定" : "Times not known yet";
  t = t.replace(/\s*\(floating; timezone unspecified\)/i, "");
  t = t.replace(/\s*\(Stand (\d{4})\)/, zh ? "（$1 年信息）" : " (as of $1)");
  // 15:00:00 → 15:00
  t = t.replace(/\b(\d{1,2}:\d{2}):00\b/g, "$1");
  // 14.30 → 14:30 (a dot between hour and minutes, not a date: no dot after it).
  t = t.replace(/\b(\d{1,2})\.(\d{2})\b(?!\.)/g, "$1:$2");
  // "22. und 25.12." → "22.12. und 25.12.", "21.–23.12." → "21.12.–23.12."
  t = t.replace(/(?<![\d.])(\d{1,2})\.\s*und\s*(\d{1,2})\.(\d{1,2})\./g, "$1.$3. und $2.$3.");
  t = t.replace(/(?<![\d.])(\d{1,2})\.\s*[–-]\s*(\d{1,2})\.(\d{1,2})\./g, "$1.$3.–$2.$3.");
  // Closed weekdays: "Mo und Di zu".
  t = t.replace(/\b((?:Mo|Di|Mi|Do|Fr|Sa|So)(?:\s*(?:und|,)\s*(?:Mo|Di|Mi|Do|Fr|Sa|So))*)\s+(?:zu|geschlossen)\b/g, (_, ds: string) => `\u0001${ds}\u0002`);
  // Closed days: "Totensonntag (22.11.) zu", "22.11. und 24.12. zu".
  t = t.replace(/(?:Totensonntag\s*)?\(?((?:\d{1,2}\.\d{1,2}\.)(?:\s*(?:und|,)\s*\d{1,2}\.\d{1,2}\.)*)\)?\s+(?:zu|geschlossen)\b/g, (_, ds: string) => `\u0001${ds}\u0002`);
  // Dates.
  t = t.replace(/\b(\d{1,2})\.(\d{1,2})\.(?!\d)/g, (_, d, m) => date(d, m, lang));
  t = t.replace(/\u0001(.*?)\u0002/g, (_, raw: string) => {
    const ds = raw.replace(/\b(Mo|Di|Mi|Do|Fr|Sa|So)\b/g, (d) => day(d, lang));
    return zh ? `${ds.replace(/\s*(?:und|,)\s*/g, "、")}休息` : `closed ${ds.replace(/\s*und\s*/g, " and ")}`;
  });
  // "Jeden ersten Sonntag im Monat"
  t = t.replace(/jeden ersten (\w+?)s? im Monat/i, (_, d) => (zh ? `每月第一个${day(FULL_DAYS[d.toLowerCase()], lang)}` : `every first ${day(FULL_DAYS[d.toLowerCase()], lang)} of the month`));
  // Weekdays: "Montags", "Mo–Fr".
  t = t.replace(/\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag)s?\b/gi, (_, d) => day(FULL_DAYS[d.toLowerCase()], lang));
  t = t.replace(/\b(Mo|Di|Mi|Do|Fr|Sa|So)\s*[–-]\s*(Mo|Di|Mi|Do|Fr|Sa|So)\b/g, (_, a, b) => (zh ? `${day(a, lang)}至${day(b, lang)}` : `${day(a, lang)}–${day(b, lang)}`));
  t = t.replace(/\b(Mo|Di|Mi|Do|Fr|Sa|So)\b(?=\s+\d|,|\s*und)/g, (_, a) => day(a, lang));
  t = t.replace(/\btäglich\b/gi, zh ? "每天" : "daily");
  // Ranges: "von 15 bis 16 Uhr", "10:30 bis 11:15", "14:30 – 17:30".
  t = t.replace(/\bvon\s+(?=\d)/gi, "");
  const lone = /^\s*\d{1,2}(?::\d{2})?\s*(?:bis|–|-)\s*\d{1,2}(?::\d{2})?\s*(?:Uhr)?\s*$/i.test(t);
  t = t.replace(/(?<![\d.])(\d{1,2}(?::\d{2})?)\s*(?:bis|–|-)\s*(\d{1,2}(?::\d{2})?)(?![\d.月])(?:\s*Uhr\b)?/g, (_, a, b) => (lone ? `${pad(a)}–${pad(b)}` : `${a}–${b}`));
  t = t.replace(/\bab\s+(\d+ [A-Z][a-z]{2}|\d+月\d+日)/g, (_, d) => (zh ? `${d}起` : `from ${d}`));
  t = t.replace(/\bab\s+(\d{1,2}(?::\d{2})?)\s*Uhr/gi, (_, a) => (zh ? `${pad(a)} 起` : `from ${pad(a)}`));
  t = t.replace(/\bab\s+(\d{1,2}(?::\d{2})?)(?![\d月:])/gi, (_, a) => (zh ? `${a} 起` : `from ${a}`));
  t = t.replace(/\bBeginn:?\s*/gi, zh ? "开始 " : "starts ");
  t = t.replace(/\bEinlass:?\s*/gi, zh ? "入场 " : "doors ");
  t = t.replace(/\bca\.\s*/gi, zh ? "约 " : "about ");
  t = t.replace(/\bbis\s+(\d{1,2}(?::\d{2})?)/gi, (_, a) => (zh ? `至 ${pad(a)}` : `until ${pad(a)}`));
  t = t.replace(/\bAbmarsch\s+(\d{1,2}(?::\d{2})?)(?:\s*Uhr)?/gi, (_, a) => (zh ? `${pad(a)} 出发` : `sets off ${pad(a)}`));
  // A single "18 Uhr".
  t = t.replace(/\b(\d{1,2}(?::\d{2})?)\s*Uhr\b/g, (_, a) => pad(a));
  t = t.replace(/\s*\bUhr\b/g, "");
  t = t.replace(/\s*\bund\b\s*/g, zh ? "和" : " and ");
  if (zh) t = t.replace(/\s*;\s*/g, "；").replace(/,\s*/g, "，").replace(/\s*([（）])\s*/g, "$1").replace(/\s*\(\s*/g, "（").replace(/\s*\)/g, "）");
  t = t.replace(/\s{2,}/g, " ").trim();
  return zh ? t : t.charAt(0).toUpperCase() + t.slice(1);
}

/** The time line of an event for the reader: German as given, else the localized line set at build time. */
export const timeOf = (e: { time?: string; times?: Partial<Record<TimeLang, string>> }, lang: string): string | undefined =>
  lang === "de" ? (e.time && /^0?0:00$/.test(e.time.trim()) ? undefined : e.time) : lang === "en" || lang === "zh" ? (e.times ? e.times[lang] : e.time) : e.time;

/** Sets `times` (English and Chinese time lines) on an event, from the rules or the translation caches. */
export function withTimes<T extends { time?: string; times?: Partial<Record<TimeLang, string>> }>(e: T, caches: Partial<Record<TimeLang, Record<string, string>>>): T {
  if (!e.time) return e;
  const times: Partial<Record<TimeLang, string>> = {};
  for (const lang of ["en", "zh"] as const) {
    const t = localTime(e.time, lang, caches[lang]);
    if (t) times[lang] = t;
  }
  return { ...e, times };
}
