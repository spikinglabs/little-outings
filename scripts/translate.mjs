// Chinese names for events and places → data/translations/zh.json, run nightly by .github/workflows/translate.yml.
//
// Reads every event title and place name the imports wrote to content/ (run import:cityklub and
// import:places first), translates the ones the cache doesn't have yet, and drops entries nothing
// uses any more. The cache is committed, so each text is translated once. The build reads it in
// src/lib/data.ts; a title someone translated by hand ({ de, zh } in a content file) always wins.
//
//   GEMINI_API_KEY=… npm run translate        (or ANTHROPIC_API_KEY; see src/lib/llm.ts for the switch)
//   TRANSLATE_MODEL=…                         optional; the provider's default otherwise
// Without a key it only reports how many texts are missing.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { load } from "js-yaml";
import { complete, pickLlm } from "../src/lib/llm.ts";

export const CACHE = "data/translations/zh.json";
const BATCH = 60;

export const PROMPT = `You translate German names of family events and kid-friendly places in Germany (Köln, Bonn, Aachen, Bergisches Land, Wuppertal area) into Simplified Chinese, for Chinese-speaking parents who live there and read little German.
- Say plainly what it is, short like a title: "Regelmäßige Vorlesestunde" → "定期亲子读书会"; "Sonntagsmalerei" → "周日绘画活动".
- Never add facts that are not in the original (no ages, prices, places that aren't there).
- Towns use their standard Chinese names: Köln 科隆, Bonn 波恩, Aachen 亚琛, Düsseldorf 杜塞尔多夫, Wuppertal 伍珀塔尔.
- Street names, people's names, brand names and proper names without an established Chinese form stay in Latin letters, with the descriptive part translated: "Spielplatz Weegen" → "Weegen 游乐场"; "Käthe-Kollwitz-Weg (KSP)" → "Käthe-Kollwitz-Weg 儿童游乐场" (KSP = Kinderspielplatz).
- A place name that is only a street or area gets its kind added: playground "Schanzenweg" → "Schanzenweg 游乐场".
- Well-known institutions may use their Chinese name: "Kölnisches Stadtmuseum" → "科隆城市博物馆".
You get a JSON array of {"text", "kind"} objects (kind is "event" or the kind of place). Return only a JSON array of the same length with the translations in the same order.`;

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
      }
    }
  };
  for (const d of ["events", "imported", "places"]) walk(join(root, d));
  return [...out].sort(([a], [b]) => (a < b ? -1 : 1)).map(([text, kind]) => ({ text, kind }));
}

/** One request for up to BATCH { text, kind } items. Returns the translations, or throws when the answer doesn't line up. */
export async function translateBatch(texts, { llm, model, fetch = globalThis.fetch }) {
  const text = await complete(llm, model, { system: PROMPT, text: JSON.stringify(texts), maxTokens: 8000, json: true }, fetch);
  const list = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  if (!Array.isArray(list) || list.length !== texts.length || list.some((s) => typeof s !== "string" || !s.trim()))
    throw new Error("translate: the answer does not match the batch");
  return list.map((s) => s.trim());
}

/** Fill the cache for `items` ({ text, kind }) and drop unused entries. Returns how many were missing and how many got translated. */
export async function update(items, cache, opts) {
  const missing = items.filter((x) => !cache[x.text]);
  let done = 0;
  if (opts.llm) {
    for (let i = 0; i < missing.length; i += BATCH) {
      const part = missing.slice(i, i + BATCH);
      try {
        (await translateBatch(part, opts)).forEach((zh, j) => (cache[part[j].text] = zh));
        done += part.length;
      } catch (e) {
        console.warn(String(e)); // a bad batch is retried next night
      }
    }
  }
  const used = new Set(items.map((x) => x.text));
  const next = Object.fromEntries(Object.keys(cache).filter((k) => used.has(k)).sort().map((k) => [k, cache[k]]));
  return { cache: next, missing: missing.length, done };
}

async function main() {
  const root = process.env.CONTENT_DIR || "content";
  const texts = textsIn(root);
  if (!texts.length) return console.log("translate: no content found; run the imports first"); // never wipe the cache
  const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
  const llm = pickLlm(process.env);
  const r = await update(texts, cache, { llm, model: process.env.TRANSLATE_MODEL });
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(r.cache, null, 1) + "\n");
  console.log(llm
    ? `translate (${llm.provider}): ${texts.length} texts, ${r.missing} new, ${r.done} translated`
    : `translate: ${texts.length} texts, ${r.missing} without Chinese (set GEMINI_API_KEY or ANTHROPIC_API_KEY to translate them)`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
