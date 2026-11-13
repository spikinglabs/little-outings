// One sentence on what an event is, and the ages it is for → data/about.json, run nightly by .github/workflows/translate.yml.
//
// The export gives only a title ("Bilderbuchkino", "Offene Werkstatt"), so parents had to open the
// German source page to learn what happens. For each upcoming event this reads the organiser's page
// once and asks the model for one plain sentence in German, English and Chinese, plus the age range
// only when the page itself states one: the model must copy the words ("für Kinder ab 4 Jahren"),
// and an age is kept only when those words are on the page and hold its numbers. Nothing is guessed
// from the kind of event. The sentence is the AI's summary of the page, so the event page says so.
//
// Answers are cached by page and title and committed, so every page is read once. Pages that list
// many events (a museum's calendar) are read once per run and the passage around the title is sent.
// Pages that don't describe the event are cached as { none: true } and not read again until READ goes up;
// a page whose text doesn't contain the title isn't sent to the model at all, and an age must stand near the title.
// import-cityklub.mjs adds the sentence (`about`) and the ages to the imported event.
//
//   GEMINI_API_KEY=… npm run describe:events  (or ANTHROPIC_API_KEY; see src/lib/llm.ts for the switch)
//   ABOUT_MODEL=…                             optional; the provider's default otherwise
//   ABOUT_LIMIT=…                             pages read per night at most (default 400)
// Without a key it only reports how many events have no sentence yet.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { complete, pickLlm } from "../src/lib/llm.ts";
import { eachLimit } from "../src/lib/pool.ts";
import { lastDay } from "../src/lib/horizon.ts";
import { pageText } from "./find-venues.mjs";

export const CACHE = "data/about.json";
const PUBLISHED = process.env.OUTINGS_FILE || "data/outings.jsonl";
const READ = 1; // bump to read pages that gave nothing again after the reader got better
const AT_ONCE = 6; // pages read at the same time, from many different sites
const MAX_TEXT = 12000; // page text sent to the model

export const PROMPT = `You read the text of one event page from a German city, library, museum or venue website, for parents who decide whether to go there with their children.
Return only JSON: {"found": true, "de": "...", "en": "...", "zh": "...", "age_quote": "...", "age_min": null, "age_max": null}.
- found: true only when the page describes the event with the given title. false when it only lists the title among others, or is a general page without a description of it.
- de, en, zh: one short plain sentence in German, English and Simplified Chinese saying what happens there: what children do, see or hear. At most 20 words (zh at most 40 characters). Only what the page says. No date, time, price, address or booking details, no praise or advertising words ("toll", "spannend", "unforgettable"). When found is false, "" for all three.
- age_quote: the exact words on the page that give the age for this event (e.g. "für Kinder von 4 bis 8 Jahren", "ab 6 Jahren", "Kinder bis 3 Jahre"). Copy them letter for letter. "" when the page gives no age for this event.
- age_min, age_max: the ages in years from age_quote. age_max null when only a lower bound is given, age_min 0 when only an upper bound is given. School grades or "Familien" without years: both null.
- Never estimate an age or a description from the kind of event or from the title alone.`;

const squash = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
export const keyOf = (row) => `${row.source_url} | ${String(row.title).trim()}`;

/** Events that get a page tonight (the import's two weeks), with a source page, soonest first. */
export function wanted(rows, today, until) {
  return rows
    .filter((r) => r.source_url && r.title && (r.end_date || r.start_date || "") >= today && r.start_date <= until
      && (!r.status || r.status === "scheduled") && r.expired !== true)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
}

/**
 * True when the page names the event: a calendar page that loads its list with JavaScript (museen.koeln)
 * has only filters like "Kinder ab 5 Jahren" in its text, and must not lend the event an age or a sentence.
 * A long title counts when its start is there ("FAMILIENTAG Magie der Materialien – …").
 */
export function namesEvent(page, title) {
  const t = squash(title);
  return t.length > 0 && squash(page).includes(t.length > 40 ? t.slice(0, 28) : t);
}

/** The part of the page that can hold this event's age: from just before its title to 3000 letters after. */
function nearTitle(page, title) {
  const i = page.toLowerCase().indexOf(String(title).trim().toLowerCase().slice(0, 30));
  return i < 0 ? page : page.slice(Math.max(0, i - 300), i + 3000);
}

/** What the model reads: the page start, or the passage around the title on a long page that lists many events. */
export function excerptFor(page, title) {
  if (page.length <= MAX_TEXT) return page;
  const i = page.toLowerCase().indexOf(String(title).trim().toLowerCase());
  if (i < 0 || i < MAX_TEXT / 2) return page.slice(0, MAX_TEXT);
  return page.slice(Math.max(0, i - 2000), i + MAX_TEXT - 2000);
}

const clip = (s, n) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "").slice(0, n);

/**
 * The model's answer as a cache entry. The sentence needs all three languages; the ages are kept only
 * when the quoted words are on the page and contain the numbers, between 0 and 18.
 */
export function parseAbout(text, page, title = "") {
  const a = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const de = clip(a.de, 240), en = clip(a.en, 240), zh = clip(a.zh, 90);
  const out = a.found === true && de && en && zh ? { de, en, zh } : { none: true };
  const quote = clip(a.age_quote, 120);
  const nums = (quote.match(/\d+/g) ?? []).map(Number);
  const min = Number.isInteger(a.age_min) ? a.age_min : null;
  const max = Number.isInteger(a.age_max) ? a.age_max : null;
  const inQuote = (n) => n == null || (n === 0 && min === 0 && max != null) || nums.includes(n);
  if (quote.length >= 4 && squash(title ? nearTitle(page, title) : page).includes(squash(quote)) && (min != null || max != null)
    && inQuote(min) && inQuote(max) && (min ?? 0) >= 0 && (max ?? 18) <= 18 && (min ?? 0) <= (max ?? 18)) {
    out.ages = [min ?? 0, max ?? 18];
    out.age_quote = quote;
  }
  return out;
}

async function readPage(url, fetch) {
  const res = await fetch(url, { headers: { "user-agent": "little-outings event summary (+https://outings.allo.land)" }, redirect: "follow" });
  if (!res.ok) throw new Error(`describe-events: HTTP ${res.status} for ${url}`);
  return pageText(await res.text());
}

/** Fill the cache for tonight's events and drop entries no event uses any more. */
export async function update(rows, cache, { llm, model, today, until, limit = 400, fetch = globalThis.fetch }) {
  const want = [...new Map(wanted(rows, today, until).map((r) => [keyOf(r), r])).values()];
  const todo = want.filter((r) => !(keyOf(r) in cache) || (cache[keyOf(r)].none && (cache[keyOf(r)].read ?? 0) < READ));
  let done = 0;
  if (llm) {
    const pages = new Map(); // url → Promise<page text>, so a calendar page is fetched once
    await eachLimit(todo.slice(0, limit), AT_ONCE, async (row) => {
      try {
        if (!pages.has(row.source_url)) pages.set(row.source_url, readPage(row.source_url, fetch));
        const page = await pages.get(row.source_url);
        if (!namesEvent(page, row.title)) { cache[keyOf(row)] = { none: true, read: READ }; done++; return; }
        const ask = `Event title: ${row.title}\nTown: ${row.location?.city ?? ""}\nOrganiser: ${row.source_name ?? ""}\n\nPage text:\n${excerptFor(page, row.title)}`;
        const found = parseAbout(await complete(llm, model, { system: PROMPT, text: ask, maxTokens: 4000, json: true }, fetch), page, row.title);
        cache[keyOf(row)] = found.none ? { ...found, read: READ } : found;
        done++;
      } catch (e) {
        console.warn(String(e).slice(0, 300));
      }
    });
  }
  const used = new Set(want.map(keyOf));
  const next = Object.fromEntries(Object.keys(cache).filter((k) => used.has(k)).sort().map((k) => [k, cache[k]]));
  return { cache: next, todo: todo.length, done };
}

async function main() {
  if (!existsSync(PUBLISHED)) return console.log(`describe-events: no ${PUBLISHED}`); // never wipe the cache
  const rows = readFileSync(PUBLISHED, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  const llm = pickLlm(process.env);
  const limit = Number(process.env.ABOUT_LIMIT) || 400;
  const r = await update(rows, cache, { llm, model: process.env.ABOUT_MODEL, today, until: lastDay(today), limit });
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(r.cache, null, 1) + "\n");
  const all = Object.values(r.cache);
  const said = all.filter((v) => v.de).length, aged = all.filter((v) => v.ages).length;
  console.log(llm
    ? `describe-events (${llm.provider}): ${r.todo} to read, ${r.done} read, ${said} events described, ${aged} with ages from the page`
    : `describe-events: ${r.todo} events without a sentence (set GEMINI_API_KEY or ANTHROPIC_API_KEY to read their pages)`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
