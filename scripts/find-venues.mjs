// Venues for events that arrive without one → data/venues.json, run nightly by .github/workflows/translate.yml.
//
// Some sources list an event with only its town. Their event pages usually still name the venue
// ("Veranstaltungsort"), so for each such event in data/outings.jsonl this reads the source page once
// and asks the model for the venue name and street. Answers are cached by page URL and committed,
// so every page is read once; pages that name no venue are cached too (venue: null).
// import-cityklub.mjs fills an event's empty venue from the cache.
//
//   GEMINI_API_KEY=… npm run find:venues      (or ANTHROPIC_API_KEY; see src/lib/llm.ts for the switch)
//   VENUE_MODEL=…                             optional; the provider's default otherwise
// Without a key it only reports how many events lack a venue.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { complete, pickLlm } from "../src/lib/llm.ts";
import { eachLimit } from "../src/lib/pool.ts";

export const CACHE = "data/venues.json";
const PUBLISHED = process.env.OUTINGS_FILE || "data/outings.jsonl";
const PER_RUN = 150; // pages read per night at most; the rest wait for the next run
const AT_ONCE = 6; // pages read at the same time, from many different sites
const MAX_TEXT = 20000; // page text sent to the model; long menus can push the venue past this…
const PLACE_WORDS = /Veranstaltungsort|Veranstaltungsadresse|Treffpunkt|\bOrt:|Adresse/i; // …so text around these is added

export const PROMPT = `You read the text of one event page from a German city or venue website and find where the event takes place.
Return only JSON: {"venue": "...", "street": "..."}.
- venue: the name of the place as written on the page (e.g. "Papiermuseum Düren", "Stadtbibliothek Aachen", "Heumarkt"). Usually under "Veranstaltungsort", "Ort" or "Adresse".
- street: street and house number if the page gives them (e.g. "Wallstraße 2-8"), otherwise "".
- Copy the words from the page. Never guess. The address of a city hall, tourist office or organiser's office is not the venue unless the page says the event happens there.
- On a venue's own website (a museum, theatre or zoo), an event without another place given takes place at that venue.
- If the page names no place for this event, return {"venue": null, "street": ""}.`;

/** Events worth a lookup: still upcoming, with a source page, but no venue, street or point. */
export function needsVenue(row, today) {
  const loc = row.location || {};
  return !!row.source_url && !row.venue && !loc.street && typeof loc.latitude !== "number"
    && (row.end_date || row.start_date || "") >= today && (!row.status || row.status === "scheduled");
}

/** Readable page text without markup, scripts or navigation noise. */
export function pageText(html) {
  const ent = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return html
    .replace(/<(script|style|noscript|svg|head|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/dt|\/dd|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === "#"
      ? String.fromCodePoint(parseInt(e[1] === "x" || e[1] === "X" ? e.slice(2) : e.slice(1), e[1] === "x" || e[1] === "X" ? 16 : 10))
      : ent[e.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

const squash = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** What the model reads: the start of the page, plus the passage naming the place when it comes later. */
export function excerpt(page) {
  if (page.length <= MAX_TEXT) return page;
  const rest = page.slice(MAX_TEXT);
  const i = rest.search(PLACE_WORDS);
  return page.slice(0, MAX_TEXT) + (i < 0 ? "" : `\n…\n${rest.slice(Math.max(0, i - 500), i + 2500)}`);
}

/** The model's answer, kept only when the venue really appears in the page text. */
export function parseAnswer(text, page) {
  const a = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const venue = typeof a.venue === "string" ? a.venue.trim() : "";
  if (!venue || !squash(page).includes(squash(venue))) return { venue: null };
  const street = typeof a.street === "string" && a.street.trim() && squash(page).includes(squash(a.street)) ? a.street.trim() : undefined;
  return street ? { venue, street } : { venue };
}

/** Look up one page. Throws when the page can't be read or the answer can't be parsed (retried next run). */
export async function lookup(row, { llm, model, fetch = globalThis.fetch }) {
  const res = await fetch(row.source_url, { headers: { "user-agent": "little-outings venue lookup (+https://outings.allo.land)" }, redirect: "follow" });
  if (!res.ok) throw new Error(`find-venues: HTTP ${res.status} for ${row.source_url}`);
  const page = pageText(await res.text());
  const ask = `Event: ${row.title}\nTown: ${row.location?.city ?? ""}\n\nPage text:\n${excerpt(page)}`;
  // Generous limit: Gemini's thinking models count their thinking against it, and a cut-off answer is invalid JSON.
  return parseAnswer(await complete(llm, model, { system: PROMPT, text: ask, maxTokens: 4000, json: true }, fetch), page);
}

/** Fill the cache for the rows that need a venue and drop pages no event uses any more. */
export async function update(rows, cache, opts) {
  const want = [...new Map(rows.filter((r) => needsVenue(r, opts.today)).map((r) => [r.source_url, r])).values()];
  const missing = want.filter((r) => !(r.source_url in cache));
  let done = 0;
  if (opts.llm) {
    await eachLimit(missing.slice(0, PER_RUN), AT_ONCE, async (row) => {
      try {
        cache[row.source_url] = await lookup(row, opts);
        done++;
      } catch (e) {
        console.warn(String(e));
      }
    });
  }
  const used = new Set(want.map((r) => r.source_url));
  const next = Object.fromEntries(Object.keys(cache).filter((k) => used.has(k)).sort().map((k) => [k, cache[k]]));
  return { cache: next, missing: missing.length, done };
}

async function main() {
  if (!existsSync(PUBLISHED)) return console.log(`find-venues: no ${PUBLISHED}`); // never wipe the cache
  const rows = readFileSync(PUBLISHED, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  const llm = pickLlm(process.env);
  const r = await update(rows, cache, { llm, model: process.env.VENUE_MODEL, today });
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(r.cache, null, 1) + "\n");
  const found = Object.values(r.cache).filter((v) => v.venue).length;
  console.log(llm
    ? `find-venues (${llm.provider}): ${r.missing} new pages, ${r.done} read, ${found} venues known`
    : `find-venues: ${r.missing} events without a venue (set GEMINI_API_KEY or ANTHROPIC_API_KEY to look them up)`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
