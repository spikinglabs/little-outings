// Chinese names for events and places → data/translations/zh.json, and English event titles →
// data/translations/en.json, run nightly by .github/workflows/translate.yml.
//
// Reads every event title and place name the imports wrote to content/ (run import:cityklub and
// import:places first), translates the ones a cache doesn't have yet, and drops entries nothing
// uses any more (a title still in data/outings.jsonl is kept, so a run that comes back later isn't
// asked again). The caches are committed, so each text is translated once per language. The build
// reads them in src/lib/data.ts; a title someone translated by hand ({ de, zh } in a content file) always wins.
//
//   GEMINI_API_KEY=… npm run translate        (or ANTHROPIC_API_KEY; see src/lib/llm.ts for the switch)
//   TRANSLATE_MODEL=…                         optional; the provider's default otherwise
//   TRANSLATE_LIMIT=…                         most new texts per language per run (default 3000)
// Without a key it only reports how many texts are missing.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { load } from "js-yaml";
import { complete, pickLlm } from "../src/lib/llm.ts";
import { ruleKnows } from "../src/lib/time-text.ts";

export const CACHE = "data/translations/zh.json";
const BATCH = 60;
const LIMIT = 3000;

export const PROMPT = `You translate German names of family events and kid-friendly places in Germany (Köln, Bonn, Aachen, Essen, Bergisches Land, Wuppertal area, Berlin, München, Frankfurt am Main, Hamburg) into Simplified Chinese, for Chinese-speaking parents who live there and read little German.
- Say plainly what it is, short like a title: "Regelmäßige Vorlesestunde" → "定期亲子读书会"; "Sonntagsmalerei" → "周日绘画活动".
- Never add facts that are not in the original (no ages, prices, places that aren't there).
- Towns use their standard Chinese names: Köln 科隆, Bonn 波恩, Aachen 亚琛, Düsseldorf 杜塞尔多夫, Essen 埃森, Wuppertal 伍珀塔尔.
- Street names, people's names, brand names and proper names without an established Chinese form stay in Latin letters, with the descriptive part translated: "Spielplatz Weegen" → "Weegen 游乐场"; "Käthe-Kollwitz-Weg (KSP)" → "Käthe-Kollwitz-Weg 儿童游乐场" (KSP = Kinderspielplatz).
- A place name that is only a street or area gets its kind added: playground "Schanzenweg" → "Schanzenweg 游乐场".
- Well-known institutions may use their Chinese name: "Kölnisches Stadtmuseum" → "科隆城市博物馆".
You get a JSON array of {"text", "kind"} objects (kind is "event" or the kind of place). Return only a JSON array of strings, one translation per object, the same length and in the same order: ["…", "…"].`;

export const PROMPT_EN = `You translate German titles of family events in Germany (Köln, Bonn, Aachen, Düsseldorf, Essen, Bergisches Land, Berlin, München, Frankfurt am Main, Hamburg) into English, for English-speaking parents who live there and read little German.
- Say plainly what it is, short like a title: "Regelmäßige Vorlesestunde" → "Regular story time"; "Sonntagsmalerei" → "Sunday painting"; "Laternenbasteln für Kinder ab 4 J." → "Lantern making for kids 4+".
- Never add facts that are not in the original (no ages, prices, places that aren't there).
- Towns use their English names where one exists: Köln Cologne, München Munich; others stay as they are.
- Names of people, brands, shows, bands and venues stay as they are: "Lesung mit Kirsten Boie" → "Reading with Kirsten Boie". A story or play keeps its German title unless it is well known in English: "Der Grüffelo" → "The Gruffalo".
- German traditions keep their name with a hint when it helps: "Martinszug" → "St. Martin's lantern walk"; "Weihnachtsmarkt" → "Christmas market".
- A title that is already English, or only a name, comes back unchanged.
- No ALL CAPS: "KINDERFLOHMARKT" → "Kids' flea market".
You get a JSON array of {"text", "kind"} objects. Return only a JSON array of strings, one translation per object, the same length and in the same order: ["…", "…"].`;

const TIME_RULES = `- Keep every number, time and date exactly; write times as 24-hour (16:30), weekdays short (Mon / 周一), dates as "22 Nov" / "11月22日".
- "zu" or "geschlossen" means closed. "Stände" are the stalls, "Bühne" the stage, "Eisbahn" the ice rink, "Umzug" the parade, "Vernissage" / "Ausstellungseröffnung" the opening.
- Keep it as short as the original. Never add facts that are not in it.
You get a JSON array of {"text", "kind"} objects. Return only a JSON array of strings, one translation per object, the same length and in the same order: ["…", "…"].`;

export const PROMPT_TIME_ZH = `You translate German time and opening-hour lines of family events and Christmas markets in Germany into Simplified Chinese, for Chinese-speaking parents: "Sa–So 12–20 Uhr; Eisbahn mit eigenen Zeiten" → "周六至周日 12–20；溜冰场时间另计".
${TIME_RULES}`;

export const PROMPT_TIME_EN = `You translate German time and opening-hour lines of family events and Christmas markets in Germany into English, for English-speaking parents: "Sa–So 12–20 Uhr; Eisbahn mit eigenen Zeiten" → "Sat–Sun 12–20; ice rink has its own times".
${TIME_RULES}`;

/** Each language's cache, prompt and which texts it covers: Chinese everything, English event titles (places keep their German names), and in both the time lines the rules in src/lib/time-text.ts can't read. */
export const LANGUAGES = [
  { lang: "zh", cache: CACHE, prompt: PROMPT, wants: (x) => x.kind !== "time" },
  { lang: "en", cache: "data/translations/en.json", prompt: PROMPT_EN, wants: (x) => x.kind === "event" },
  { lang: "time-zh", cache: "data/translations/time-zh.json", prompt: PROMPT_TIME_ZH, wants: (x) => x.kind === "time" },
  { lang: "time-en", cache: "data/translations/time-en.json", prompt: PROMPT_TIME_EN, wants: (x) => x.kind === "time" },
];

/** Every untranslated event title and place name in the content folder as { text, kind }, in a stable order. */
export function textsIn(root) {
  const out = new Map();
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ya?ml|md)$/.test(f)) {
        const raw = readFileSync(p, "utf8");
        const doc = f.endsWith(".md") ? load(raw.split(/^---\s*$/m)[1] ?? "") : load(raw);
        // Places have a plain-string name; events a title that may already carry { de, zh }.
        const s = doc?.title ?? doc?.name;
        if (typeof s === "string" && s.trim() && !out.has(s)) out.set(s, doc.title ? "event" : doc.kind ?? "place");
        // Season fixtures (Christmas markets): a list of items with a name and opening hours.
        for (const it of Array.isArray(doc?.items) ? doc.items : []) {
          if (typeof it?.name === "string" && it.name.trim() && !out.has(it.name)) out.set(it.name, "event");
          addTime(it?.hours);
        }
        addTime(doc?.time);
      }
    }
  };
  // Time lines the rules can't read ("Vernissage: 7. November, 18 Uhr …") are translated like titles.
  const addTime = (t) => { if (typeof t === "string" && /[a-zäöüß]{2}/i.test(t) && !ruleKnows(t.trim()) && !out.has(t.trim())) out.set(t.trim(), "time"); };
  for (const d of ["events", "imported", "places", "seasons"]) walk(join(root, d));
  return [...out].sort(([a], [b]) => (a < b ? -1 : 1)).map(([text, kind]) => ({ text, kind }));
}

/** One request for up to BATCH { text, kind } items. Returns the translations, or throws when the answer doesn't line up. */
export async function translateBatch(texts, { llm, model, prompt = PROMPT, fetch = globalThis.fetch }) {
  const text = await complete(llm, model, { system: prompt, text: JSON.stringify(texts), maxTokens: 8000, json: true }, fetch);
  const raw = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  // Claude often answers in the shape it was given, [{ "text": "<translation>", "kind": … }], where Gemini
  // gives plain strings; take either.
  const list = Array.isArray(raw) ? raw.map(asText) : null;
  if (!list || list.length !== texts.length || list.some((s) => !s))
    throw new Error(`translate: the answer does not match the batch (${list ? `${list.length} of ${texts.length}, ${list.filter((s) => !s).length} empty` : "no array"}): ${text.slice(0, 160)}`);
  return list;
}

/** One translation from an answer item: a string, or an object carrying it. */
function asText(item) {
  const s = typeof item === "string" ? item
    : item && typeof item === "object" ? item.translation ?? item.zh ?? item.en ?? item.text : undefined;
  return typeof s === "string" ? s.trim() : "";
}

/**
 * Fill the cache for `items` ({ text, kind }), at most `limit` new ones, and drop entries neither
 * `items` nor `keep` (a Set of texts) uses. Returns how many were missing and how many got translated.
 */
export async function update(items, cache, opts) {
  const missing = items.filter((x) => !cache[x.text]);
  let done = 0;
  if (opts.llm) {
    const todo = missing.slice(0, opts.limit ?? LIMIT);
    for (let i = 0; i < todo.length; i += BATCH) {
      const part = todo.slice(i, i + BATCH);
      try {
        (await translateBatch(part, opts)).forEach((zh, j) => (cache[part[j].text] = zh));
        done += part.length;
      } catch (e) {
        console.warn(String(e)); // a bad batch is retried next night
      }
    }
  }
  const used = new Set([...items.map((x) => x.text), ...(opts.keep ?? [])]);
  const next = Object.fromEntries(Object.keys(cache).filter((k) => used.has(k)).sort().map((k) => [k, cache[k]]));
  return { cache: next, missing: missing.length, done };
}

/** Every title in data/outings.jsonl, published or not, so a cache keeps what later runs will need again. */
function outingTitles(file = "data/outings.jsonl") {
  if (!existsSync(file)) return new Set();
  return new Set(readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l).title; } catch { return undefined; } }).filter(Boolean));
}

async function main() {
  const root = process.env.CONTENT_DIR || "content";
  const texts = textsIn(root);
  if (!texts.length) return console.log("translate: no content found; run the imports first"); // never wipe the cache
  const llm = pickLlm(process.env);
  const limit = Number(process.env.TRANSLATE_LIMIT) || LIMIT;
  const keep = outingTitles();
  const lines = [];
  for (const { lang, cache: file, prompt, wants } of LANGUAGES) {
    const items = texts.filter(wants);
    const cache = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    const r = await update(items, cache, { llm, model: process.env.TRANSLATE_MODEL, prompt, limit, keep });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(r.cache, null, 1) + "\n");
    lines.push(llm ? `${lang} ${items.length} texts, ${r.missing} new, ${r.done} translated` : `${lang} ${r.missing} of ${items.length} missing`);
  }
  console.log(llm
    ? `translate (${llm.provider}): ${lines.join("; ")}`
    : `translate: ${lines.join("; ")} (set GEMINI_API_KEY or ANTHROPIC_API_KEY to translate them)`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
