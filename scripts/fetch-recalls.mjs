// Recent recalls of children's products sold in Germany → data/recalls.json, before every build (so nightly),
// for the recall line on Discover and the weekend pages (src/components/RecallLine.astro).
// From Allo Recalls (recalls.allo.land, repo spikinglabs/recall-tracker), which collects and translates them daily:
// German notices (lebensmittelwarnung.de) and EU Safety Gate alerts notified by Germany, from the last DAYS days.
// Each links to its own page on recalls.allo.land. Never fails the build: without the file the line is not shown.
//
//   npm run fetch:recalls       RECALLS_EXPORT=… a URL or a file (default: Allo Recalls' latest file)
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const OUT = process.env.RECALLS_FILE || "data/recalls.json";
const EXPORT = process.env.RECALLS_EXPORT || "https://recalls-api.allo.land/baby/scraped_date%3Dlatest/processed.json";
export const DAYS = 30;
const MAX = 12;

const LANGS = { de: "de", en: "en", zh: "zh-CN" };
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (day, n) => iso(new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5));

/** Sold in Germany: a German notice, or an EU alert Germany notified. */
export const inGermany = (r) => r?.country_sold_in === "DE" || (r?.country_sold_in === "EU" && (r.location_sold_in ?? []).includes("DE"));

const text = (v, lang) => (typeof v === "string" ? v : v?.[LANGS[lang]] || v?.en || v?.de || "");
const clean = (s) => String(s).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\s+/g, " ").trim();

/** The recalls the site shows: for children, in Germany, from the last DAYS days, newest first, with titles per language. */
export function pick(records, today) {
  const oldest = addDays(today, -DAYS);
  return records
    .filter((r) => r?.id && r.for_children !== false && inGermany(r) && r.publish_date >= oldest && r.publish_date <= today)
    .sort((a, b) => b.publish_date.localeCompare(a.publish_date) || String(a.id).localeCompare(String(b.id)))
    .slice(0, MAX)
    .map((r) => ({
      id: r.id,
      published: r.publish_date,
      ...(r.category ? { category: r.category } : {}),
      title: Object.fromEntries(Object.keys(LANGS).map((l) => [l, clean(text(r.title_i18n, l) || r.title)])),
    }));
}

async function main() {
  const today = process.env.RECALLS_TODAY || iso(new Date());
  let records;
  try {
    if (/^https?:/.test(EXPORT)) {
      const res = await fetch(EXPORT, { headers: { "user-agent": "little-outings (+https://outings.allo.land)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      records = await res.json();
    } else records = existsSync(EXPORT) ? JSON.parse(readFileSync(EXPORT, "utf8")) : [];
  } catch (e) {
    console.log(`recalls: could not read Allo Recalls (${e.message}); no recall line this build`);
    return;
  }
  const recalls = pick(Array.isArray(records) ? records : [], today);
  writeFileSync(OUT, JSON.stringify({ fetched: today, recalls }, null, 1) + "\n");
  console.log(`recalls: ${recalls.length} of ${records.length} for children in Germany from the last ${DAYS} days`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
