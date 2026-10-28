// Venues for events that arrive without one → data/venues.json, run nightly by .github/workflows/translate.yml.
//
// Some sources list an event with only its town. Their event pages usually still name the venue
// ("Veranstaltungsort"), so for each such event in data/outings.jsonl this reads the source page once
// and asks the model for the venue name and street. Answers are cached by page URL and committed,
// so every page is read once; pages that name no venue are cached too (venue: null).
// import-cityklub.mjs fills an event's empty venue from the cache.
//
// When the page names no place, a second question asks for a best guess (`guess`): the model may
// only pick one of the venues other events in that town use, or the organiser's own venue, and
// must say why. A guess is never shown as fact: it becomes the first "Is it here?" chip in
// "Still missing" (src/lib/where-guess.ts), marked as the AI's, and goes live only once two parents
// pick it. Pages that gave no venue are read again when READ goes up.
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
const READ = 3; // bump to read pages without a venue again after the reader got better
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

export const GUESS_PROMPT = `An event page from a German city or venue website does not say where the event takes place.
Guess the single most likely place, for parents who will check it. Return only JSON: {"pick": <number or null>, "venue": "...", "why": "..."}.
- pick: the number of a place from the list of venues other events in this town use, when one fits clearly (e.g. a reading or "Bilderbuchkino" by the city library → the library; a workshop by a museum → that museum).
- venue: only when pick is null and the organiser is itself a place (a museum, zoo, library or theatre running its own programme): that place's name. Otherwise "".
- why: one short sentence in English with the clue (organiser, words in the title or text).
- Guess only from a real clue. A city hall, tourist office or ticket shop is not a venue. Without a clear clue return {"pick": null, "venue": "", "why": ""}.`;

/** Upcoming venues in a town that events name, with their street when known, most used first. */
export function townVenues(rows, city, max = 40) {
  const seen = new Map();
  for (const r of rows) {
    if (String(r.location?.city ?? "").toLowerCase() !== String(city ?? "").toLowerCase() || !r.venue) continue;
    const street = [r.location?.street, r.location?.house_number].filter(Boolean).join(" ");
    const k = squash(r.venue);
    const v = seen.get(k) ?? { venue: r.venue.trim(), street: "", n: 0 };
    v.n++;
    if (!v.street && street) v.street = street;
    seen.set(k, v);
  }
  return [...seen.values()].sort((a, b) => b.n - a.n).slice(0, max).map(({ venue, street }) => (street ? { venue, street } : { venue }));
}

/**
 * The model's guess, kept only when it is one of the listed venues, or the organiser's own place
 * (its name appears in the organiser's name, on the page, or in the page's web address:
 * couven-museum.de lists only "Öffentliche Führung" and a time). Anything else is no guess.
 */
export function parseGuess(text, { venues, organiser = "", page = "", url = "" }) {
  const a = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const why = typeof a.why === "string" ? a.why.trim().slice(0, 200) : "";
  const n = Number(a.pick);
  if (Number.isInteger(n) && n >= 1 && n <= venues.length) return { ...venues[n - 1], why };
  const venue = typeof a.venue === "string" ? a.venue.trim() : "";
  const site = squash(hostOf(url).replace(/^www\./, "").replace(/\.[a-z]+$/, ""));
  if (venue.length >= 4 && (squash(organiser).includes(squash(venue)) || squash(page).includes(squash(venue))
    || (site.length >= 6 && squash(venue).includes(site)))) return { venue, why };
  return null;
}

/** Events worth a lookup: still upcoming, with a source page, but no venue, street or point. */
export function needsVenue(row, today) {
  const loc = row.location || {};
  return !!row.source_url && !row.venue && !loc.street && typeof loc.latitude !== "number"
    && (row.end_date || row.start_date || "") >= today && (!row.status || row.status === "scheduled");
}

/** Readable page text without markup, scripts or navigation noise. */
export function pageText(html) {
  // German letters too: Düren's calendar writes "D&uuml;ren", which never matched the model's "Düren".
  const ent = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", auml: "ä", ouml: "ö", uuml: "ü", szlig: "ß",
    eacute: "é", ndash: "–", mdash: "—", bdquo: "„", ldquo: "“", rdquo: "”", hellip: "…" };
  return html
    .replace(/<(script|style|noscript|svg|head|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/dt|\/dd|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === "#"
      ? String.fromCodePoint(parseInt(e[1] === "x" || e[1] === "X" ? e.slice(2) : e.slice(1), e[1] === "x" || e[1] === "X" ? 16 : 10))
      : ent[e] ?? ent[e.toLowerCase()]?.toUpperCase() ?? m)
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ""; } };
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

/** The text of an event page. Throws when it can't be read (retried next run). */
async function readPage(url, fetch = globalThis.fetch) {
  const res = await fetch(url, { headers: { "user-agent": "little-outings venue lookup (+https://outings.allo.land)" }, redirect: "follow" });
  if (!res.ok) throw new Error(`find-venues: HTTP ${res.status} for ${url}`);
  return pageText(await res.text());
}

/** Look up one page. Throws when the page can't be read or the answer can't be parsed (retried next run). */
export async function lookup(row, { llm, model, fetch = globalThis.fetch, rows = [] }) {
  const page = await readPage(row.source_url, fetch);
  const ask = `Event: ${row.title}\nTown: ${row.location?.city ?? ""}\n\nPage text:\n${excerpt(page)}`;
  // Generous limit: Gemini's thinking models count their thinking against it, and a cut-off answer is invalid JSON.
  const found = parseAnswer(await complete(llm, model, { system: PROMPT, text: ask, maxTokens: 4000, json: true }, fetch), page);
  return found.venue ? found : { ...found, guess: await guess(row, page, { llm, model, fetch, rows }) };
}

/** A best guess for a page that names no place (see GUESS_PROMPT), or null. */
export async function guess(row, page, { llm, model, fetch = globalThis.fetch, rows = [] }) {
  const venues = townVenues(rows, row.location?.city);
  const organiser = row.source_name || row.provenance?.[0]?.source_name || "";
  const list = venues.map((v, i) => `${i + 1}. ${v.venue}${v.street ? `, ${v.street}` : ""}`).join("\n") || "(none)";
  const ask = `Event: ${row.title}\nTown: ${row.location?.city ?? ""}\nOrganiser: ${organiser}\nWebsite: ${row.source_url}\n\nVenues other events in this town use:\n${list}\n\nPage text:\n${excerpt(page).slice(0, 8000)}`;
  return parseGuess(await complete(llm, model, { system: GUESS_PROMPT, text: ask, maxTokens: 4000, json: true }, fetch), { venues, organiser, page, url: row.source_url });
}

/** Fill the cache for the rows that need a venue and drop pages no event uses any more. */
export async function update(rows, cache, opts) {
  const want = [...new Map(rows.filter((r) => needsVenue(r, opts.today)).map((r) => [r.source_url, r])).values()];
  const missing = want.filter((r) => !(r.source_url in cache));
  // Pages that gave no venue under an older reader (READ) are read again, once: guesses came in 2,
  // German letters like "&uuml;" in 3.
  const stale = want.filter((r) => cache[r.source_url] && !cache[r.source_url].venue && (cache[r.source_url].read ?? 1) < READ);
  let done = 0;
  if (opts.llm) {
    const all = { ...opts, rows };
    await eachLimit([...missing, ...stale].slice(0, PER_RUN), AT_ONCE, async (row) => {
      try {
        const found = await lookup(row, all);
        cache[row.source_url] = found.venue ? found : { ...found, read: READ };
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
  const guessed = Object.values(r.cache).filter((v) => v.guess).length;
  console.log(llm
    ? `find-venues (${llm.provider}): ${r.missing} new pages, ${r.done} read, ${found} venues known, ${guessed} best guesses`
    : `find-venues: ${r.missing} events without a venue (set GEMINI_API_KEY or ANTHROPIC_API_KEY to look them up)`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
