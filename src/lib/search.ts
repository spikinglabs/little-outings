// Search for AI assistants and other tools: GET /api/v1/search and the MCP connector at /mcp.
// The build writes a compact index (/api/v1/search-index.json) and the full records split into a
// few files (/api/v1/items/<n>.json); the functions read those, so the search needs no database.
// Pure code with no Astro imports: it runs at build time and inside Cloudflare Pages Functions.
import { lastDay } from "./horizon.ts";
import type { Event, Place } from "./types";

export type Lang = "de" | "en" | "zh";
type Text = string | { de: string; en?: string; zh?: string };

/** One event or place in the index, kept short: the whole index is read for every search. */
export interface Entry {
  t: "e" | "p";
  id: string;
  /** Name or title in German, English and Chinese (only when they differ from German). */
  n: string;
  en?: string;
  zh?: string;
  /** Place kind, or event tags. */
  k: string[];
  town?: string;
  /** District, venue or street: where in town. */
  at?: string;
  lat?: number;
  lon?: number;
  /** Events: first and last day, and the time as written. */
  s?: string;
  e?: string;
  tm?: string;
  in?: boolean;
  free?: boolean;
  /** Places: facilities someone confirmed. */
  has?: string[];
}
export interface Town { name: string; lat: number; lon: number; en?: string; zh?: string }
export interface Index { generated: string; today: string; towns: Town[]; items: Entry[] }

/** How many files the full records are split into, by a hash of the id. */
export const SHARDS = 16;
export function shardOf(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % SHARDS;
}

// Few records say whether they're indoors, so the index guesses from the kind or tags (rainy-day searches).
const INDOOR = ["indoor", "museum", "cafe", "stage", "reading", "learn", "diy", "tour", "music", "parents"];
const OUTDOOR = ["playground", "park", "zoo", "farm", "fun", "outside", "fest", "market"];
export const indoorGuess = (said: boolean | undefined, kinds: string[]) =>
  said ?? (kinds.some((k) => OUTDOOR.includes(k)) ? false : kinds.some((k) => INDOOR.includes(k)) ? true : undefined);

const text = (v: Text | undefined, lang: Lang) => (v === undefined ? "" : typeof v === "string" ? v : v[lang] || v.de);

export function entryOf(x: Event | Place): Entry {
  const geo = x.geo.lat !== undefined && x.geo.lon !== undefined ? { lat: x.geo.lat, lon: x.geo.lon } : {};
  if (x.type === "place") {
    const has = Object.entries(x.facilities).filter(([, f]) => f.status === "yes").map(([k]) => k);
    return {
      t: "p", id: x.id, n: x.name, ...(x.names?.en ? { en: x.names.en } : {}), ...(x.names?.zh ? { zh: x.names.zh } : {}), k: [x.kind], town: x.town,
      ...((x.district || x.street) ? { at: [x.district, x.street].filter(Boolean).join(", ") } : {}), ...geo,
      ...(indoorGuess(x.indoor, [x.kind]) !== undefined ? { in: indoorGuess(x.indoor, [x.kind]) } : {}), ...(x.free ? { free: true } : {}), ...(has.length ? { has } : {}),
    };
  }
  const de = text(x.title, "de"), en = text(x.title, "en"), zh = text(x.title, "zh");
  return {
    t: "e", id: x.id, n: de, ...(en !== de ? { en } : {}), ...(zh !== de ? { zh } : {}), k: x.tags,
    ...(x.town ? { town: x.town } : {}), ...(x.venue ? { at: x.venue } : {}), ...geo, s: x.start, e: x.end,
    ...(x.time ? { tm: x.time } : {}), ...(indoorGuess(x.indoor, x.tags) !== undefined ? { in: indoorGuess(x.indoor, x.tags) } : {}), ...(x.price?.free ? { free: true } : {}),
  };
}

// --- Searching -------------------------------------------------------------------------------

export const PLACE_KINDS = ["playground", "indoor", "park", "zoo", "farm", "pool", "museum", "cafe", "fun", "winter"];
export const EVENT_TAGS = ["fest", "animals", "market", "diy", "season", "reading", "music", "outside", "stage", "sport", "tour", "parents", "learn", "other"];
export const FACILITIES = ["playground", "changing_table", "highchairs", "kids_menu", "toys", "animals", "stroller_friendly",
  "nursing_room", "indoor_play", "toilets", "farm_shop", "parking", "sandpit", "water_play", "swings", "slides", "climbing",
  "toddler_area", "shade", "benches", "fenced"];

export interface Query {
  /** Free text: words in titles and venues; town names, "today", "weekend" and kinds like "playground" are understood too. */
  q?: string;
  town?: string;
  lat?: number;
  lon?: number;
  radius_km?: number;
  from?: string;
  to?: string;
  what?: "events" | "places" | "all";
  kinds?: string[];
  indoor?: boolean;
  free?: boolean;
  /** Places: facilities that must be confirmed. */
  needs?: string[];
  lang?: Lang;
  limit?: number;
}

export interface Hit {
  id: string;
  type: "event" | "place";
  title: string;
  title_de?: string;
  kind?: string;
  tags?: string[];
  dates?: string;
  time?: string;
  town?: string;
  where?: string;
  distance_km?: number;
  indoor?: boolean;
  free?: boolean;
  facilities?: string[];
  url: string;
}
export interface Result { today: string; from?: string; to?: string; town?: string; total: number; results: Hit[]; notes: string[] }

// Words in a free-text query that stand for a kind or tag (English and German; the assistant translates the rest).
const WORDS: Record<string, string> = {
  playground: "playground", playgrounds: "playground", spielplatz: "playground", spielplätze: "playground",
  indoor: "indoor", softplay: "indoor", indoorspielplatz: "indoor", park: "park", parks: "park", garden: "park",
  zoo: "zoo", zoos: "zoo", tierpark: "zoo", wildpark: "zoo", farm: "farm", farms: "farm", bauernhof: "farm",
  pool: "pool", pools: "pool", swimming: "pool", schwimmbad: "pool", bad: "pool", lake: "pool", badesee: "pool",
  museum: "museum", museums: "museum", cafe: "cafe", café: "cafe", cafes: "cafe", cafés: "cafe",
  festival: "fest", fest: "fest", market: "market", markt: "market", flohmarkt: "market",
  crafts: "diy", basteln: "diy", reading: "reading", story: "reading", vorlesen: "reading", music: "music", musik: "music",
  concert: "music", theatre: "stage", theater: "stage", cinema: "stage", kino: "stage", film: "stage", puppet: "stage",
  sport: "sport", sports: "sport", tour: "tour", führung: "tour", course: "learn", kurs: "learn",
};
const FAC_WORDS: Record<string, string> = {
  sandpit: "sandpit", sandbox: "sandpit", sandkasten: "sandpit", swings: "swings", swing: "swings", schaukel: "swings",
  slide: "slides", slides: "slides", rutsche: "slides", highchair: "highchairs", highchairs: "highchairs", hochstuhl: "highchairs",
  wickeltisch: "changing_table", toilets: "toilets", toilet: "toilets", toilette: "toilets", parking: "parking", parkplatz: "parking",
  fenced: "fenced", eingezäunt: "fenced", climbing: "climbing", klettern: "climbing", shade: "shade", schatten: "shade",
};
const STOP = new Set(["the", "and", "for", "with", "kids", "kid", "children", "family", "families", "near", "around", "this",
  "things", "what", "where", "some", "der", "die", "das", "und", "mit", "für", "kinder", "familie", "familien", "bei", "nähe", "um", "in", "im", "at", "on", "to", "of", "a"]);
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
// "Koeln" and "Köln" alike.
const loose = (s: string) => fold(s.replace(/ä/gi, "a").replace(/ö/gi, "o").replace(/ü/gi, "u")).replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u");

export function findTown(name: string, towns: Town[]): Town | undefined {
  const want = loose(name.trim());
  return towns.find((t) => [t.name, t.en, t.zh].some((x) => x && loose(x) === want));
}

const DAY = 864e5;
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const isDate = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));

/** Date words in a query: today, tomorrow, (this) weekend, in English, German and Chinese. */
function dateWords(words: string[], today: string): { from: string; to: string } | undefined {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  const has = (...w: string[]) => words.some((x) => w.includes(x));
  if (has("today", "heute", "今天")) return { from: today, to: today };
  if (has("tomorrow", "morgen", "明天")) return { from: addDays(today, 1), to: addDays(today, 1) };
  if (has("weekend", "wochenende", "周末")) {
    const sat = dow === 0 ? addDays(today, -1) : addDays(today, (6 - dow + 7) % 7);
    return { from: sat < today ? today : sat, to: addDays(sat, 1) };
  }
  return undefined;
}

function km(a: { lat: number; lon: number }, b: { lat?: number; lon?: number }) {
  if (b.lat === undefined || b.lon === undefined) return undefined;
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

const pathOf = (lang: Lang, x: Entry) => `/${lang}/${x.t === "p" ? "orte" : "termine"}/${x.id}/`;

export function search(index: Index, query: Query, base: string): Result {
  const lang: Lang = query.lang && ["de", "en", "zh"].includes(query.lang) ? query.lang : "en";
  const notes: string[] = [];
  const limit = Math.min(Math.max(Math.round(Number(query.limit) || 20), 1), 50);
  let kinds = (query.kinds ?? []).map((k) => String(k).toLowerCase()).filter(Boolean);
  const unknownKinds = kinds.filter((k) => !PLACE_KINDS.includes(k) && !EVENT_TAGS.includes(k));
  if (unknownKinds.length) notes.push(`Unknown kinds ignored: ${unknownKinds.join(", ")}. Places: ${PLACE_KINDS.join(", ")}. Events: ${EVENT_TAGS.join(", ")}.`);
  kinds = kinds.filter((k) => !unknownKinds.includes(k));
  const needs = (query.needs ?? []).filter((f) => FACILITIES.includes(f));

  // Pick towns, dates and kinds out of the free text; what's left is matched against titles.
  let town = query.town ? findTown(query.town, index.towns) : undefined;
  if (query.town && !town) notes.push(`"${query.town}" isn't a town Allo Outings covers. Towns: ${index.towns.map((t) => t.en ?? t.name).join(", ")}.`);
  let { from, to } = query;
  const raw = (query.q ?? "").toLowerCase().split(/[\s,.;!?]+/).filter(Boolean);
  const words: string[] = [];
  const dates = dateWords(raw, index.today);
  for (let i = 0; i < raw.length; i++) {
    const two = i + 1 < raw.length ? findTown(`${raw[i]} ${raw[i + 1]}`, index.towns) : undefined;
    const one = findTown(raw[i], index.towns);
    if (two || one) { town ??= two ?? one; if (two) i++; continue; }
    if (FAC_WORDS[raw[i]]) { if (!needs.includes(FAC_WORDS[raw[i]])) needs.push(FAC_WORDS[raw[i]]); continue; }
    if (WORDS[raw[i]]) { if (!kinds.includes(WORDS[raw[i]])) kinds.push(WORDS[raw[i]]); continue; }
    if (["today", "heute", "tomorrow", "morgen", "weekend", "wochenende", "this", "next", "今天", "明天", "周末"].includes(raw[i])) continue;
    if (raw[i].length >= 3 && !STOP.has(raw[i])) words.push(fold(raw[i]));
  }
  if (!isDate(from)) from = dates?.from ?? index.today;
  if (from < index.today) from = index.today;
  if (!isDate(to) || to < from) to = dates?.to ?? addDays(from, 6);
  // Events are only listed two weeks ahead, the same as Discover's "next two weeks".
  const last = lastDay(index.today);
  if (to > last) {
    notes.push(`Events are listed up to ${last} (two weeks ahead); later ones appear as that date comes closer.`);
    to = last;
  }

  const center = query.lat !== undefined && query.lon !== undefined && Number.isFinite(+query.lat) && Number.isFinite(+query.lon)
    ? { lat: +query.lat, lon: +query.lon } : town;
  const radius = Math.min(Math.max(Number(query.radius_km) || 10, 1), 100);
  const what = query.what === "events" || query.what === "places" ? query.what : "all";

  const matches = (x: Entry) => {
    if (what === "events" && x.t !== "e") return false;
    if (what === "places" && x.t !== "p") return false;
    if (x.t === "e" && (x.e! < from! || x.s! > to!)) return false;
    if (kinds.length && !x.k.some((k) => kinds.includes(k))) return false;
    if (query.indoor !== undefined && x.in !== query.indoor) return false;
    if (query.free && !x.free) return false;
    if (needs.length && (x.t === "e" || !needs.every((f) => x.has?.includes(f)))) return false;
    if (center) {
      const d = km(center, x);
      if (d === undefined ? !(town && x.town === town.name) : d > radius) return false;
    }
    return true;
  };
  let pool = index.items.filter(matches);
  let ranked = false;
  if (words.length) {
    const score = (x: Entry) => { const hay = fold([x.n, x.en, x.zh, x.at, x.town].filter(Boolean).join(" ")); return words.filter((w) => hay.includes(w)).length; };
    const scored = pool.map((x) => [x, score(x)] as const).filter(([, s]) => s > 0);
    if (scored.length) { pool = scored.sort((a, b) => b[1] - a[1]).map(([x]) => x); ranked = true; }
    else notes.push(`Nothing matched the words "${words.join(" ")}", so these are everything else that fits.`);
  }
  if (!ranked) {
    const dist = (x: Entry) => (center ? km(center, x) ?? radius : 0);
    // Events by date, then places; nearer first within each.
    pool.sort((a, b) => (a.t === b.t ? (a.t === "e" ? a.s!.localeCompare(b.s!) : 0) || dist(a) - dist(b) : a.t === "e" ? -1 : 1));
  }
  if (needs.length && !pool.length) notes.push(`Few facilities are confirmed yet (parents add them as they visit), and none of these has ${needs.join(", ")} confirmed. Search again without them; "unknown" doesn't mean missing.`);
  if (what !== "places" && pool.every((x) => x.t === "p") && pool.length) notes.push("No events match; these are places.");

  const results = pool.slice(0, limit).map((x): Hit => {
    const title = (lang === "en" && x.en) || (lang === "zh" && x.zh) || x.n;
    const d = center ? km(center, x) : undefined;
    const t = index.towns.find((t) => t.name === x.town);
    return {
      id: x.id, type: x.t === "e" ? "event" : "place", title, ...(title !== x.n ? { title_de: x.n } : {}),
      ...(x.t === "p" ? { kind: x.k[0] } : { tags: x.k, dates: x.s === x.e ? x.s : `${x.s} to ${x.e}`, ...(x.tm ? { time: x.tm } : {}) }),
      ...(x.town ? { town: (lang !== "de" && t?.[lang]) || x.town } : {}), ...(x.at ? { where: x.at } : {}),
      ...(d !== undefined ? { distance_km: Math.round(d * 10) / 10 } : {}),
      ...(x.in !== undefined ? { indoor: x.in } : {}), ...(x.free ? { free: true } : {}), ...(x.has ? { facilities: x.has } : {}),
      url: base + pathOf(lang, x),
    };
  });
  return {
    today: index.today, ...(what !== "places" ? { from, to } : {}), ...(town ? { town: town.en ?? town.name } : {}),
    total: pool.length, results, notes,
  };
}

// --- Reading the built files from inside a Pages Function -------------------------------------

/** Fetches a file of the deployed site (env.ASSETS.fetch in a Pages Function). */
export type Assets = (path: string) => Promise<Response>;

/** Today in Germany; the index's own date is the last build's. */
export const berlinToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());

// Kept per isolate: a deploy starts new isolates, so these never outlive the files they came from.
let indexCache: Promise<Index> | undefined;
const shardCache = new Map<number, Promise<(Event | Place)[]>>();

export async function loadIndex(assets: Assets): Promise<Index> {
  indexCache ??= assets("/api/v1/search-index.json").then((r) => {
    if (!r.ok) throw new Error(`search index: ${r.status}`);
    return r.json() as Promise<Index>;
  });
  try {
    return { ...(await indexCache), today: berlinToday() };
  } catch (e) {
    indexCache = undefined;
    throw e;
  }
}

export async function loadItem(assets: Assets, id: string): Promise<Event | Place | undefined> {
  const n = shardOf(id);
  if (!shardCache.has(n)) {
    shardCache.set(n, assets(`/api/v1/items/${n}.json`).then(async (r) => {
      if (!r.ok) throw new Error(`items ${n}: ${r.status}`);
      return ((await r.json()) as { items: (Event | Place)[] }).items;
    }));
  }
  try {
    return (await shardCache.get(n)!).find((x) => x.id === id);
  } catch (e) {
    shardCache.delete(n);
    throw e;
  }
}

/** One event or place for an assistant: a readable summary plus the facts it's made from. */
export function details(x: Event | Place, lang: Lang, base: string, towns: Town[]) {
  const url = base + pathOf(lang, { t: x.type === "place" ? "p" : "e", id: x.id } as Entry);
  const townOf = (name?: string) => (name && lang !== "de" && towns.find((t) => t.name === name)?.[lang]) || name;
  const lines: string[] = [];
  let title: string;
  let facts: Record<string, unknown>;
  if (x.type === "event") {
    title = text(x.title, lang);
    facts = {
      type: "event", dates: x.start === x.end ? x.start : `${x.start} to ${x.end}`, time: x.time,
      venue: x.venue, town: townOf(x.town), location_precision: x.geo.precision,
      ...(x.geo.lat !== undefined && x.geo.precision === "exact" ? { lat: x.geo.lat, lon: x.geo.lon } : {}),
      price: x.price ? (x.price.free ? "free" : text(x.price.text, lang) || undefined) : undefined,
      tags: x.tags, indoor: x.indoor, ages: x.ages, german_needed: x.language,
      website: x.website, source: x.origin?.name ?? (typeof x.trust.source === "string" ? x.trust.source : x.trust.source?.de),
      added_by: x.trust.level,
    };
    lines.push(`${title}${title !== text(x.title, "de") ? ` (${text(x.title, "de")})` : ""}`,
      `When: ${facts.dates}${x.time ? `, ${x.time}` : ""}`,
      `Where: ${[x.venue, townOf(x.town)].filter(Boolean).join(", ") || "not known yet"}${x.geo.precision === "area" ? " (no exact address yet)" : ""}`);
    if (facts.price) lines.push(`Price: ${facts.price}`);
    if (x.note) lines.push(text(x.note, lang));
  } else {
    title = (lang !== "de" && x.names?.[lang]) || x.name;
    const yes = Object.entries(x.facilities).filter(([, f]) => f.status === "yes").map(([k]) => k);
    const no = Object.entries(x.facilities).filter(([, f]) => f.status === "no").map(([k]) => k);
    facts = {
      type: "place", kind: x.kind, address: [x.street ?? (x.near ? `near ${x.near}` : undefined), x.postcode, townOf(x.town)].filter(Boolean).join(", "),
      district: x.district, ...(x.geo.lat !== undefined ? { lat: x.geo.lat, lon: x.geo.lon } : {}),
      hours: x.hours ? text(x.hours, lang) : undefined, indoor: x.indoor, free: x.free, ages: x.ages,
      has: yes, does_not_have: no, tips: x.tips, visits: x.visits, website: x.website, added_by: x.trust.level,
    };
    lines.push(title, `Kind: ${x.kind}`, `Address: ${facts.address || "not known"}`);
    if (facts.hours) lines.push(`Opening hours: ${facts.hours}`);
    if (yes.length) lines.push(`Confirmed: ${yes.join(", ")}`);
    if (no.length) lines.push(`Not there: ${no.join(", ")}`);
    for (const t of x.tips ?? []) lines.push(`Parents' tip (${t.topic}): ${t.text}`);
    if (x.note) lines.push(text(x.note, lang));
    lines.push("Facilities not listed are unknown, not missing.");
  }
  if (x.website) lines.push(`Website: ${x.website}`);
  lines.push("Please check with the organiser before going.");
  const metadata = Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)));
  return { id: x.id, title, text: lines.join("\n"), url, metadata };
}
