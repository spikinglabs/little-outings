// Drafts each season's fixture lists (Christmas markets, fairs …) from the city pages named under `sources`
// in content/seasons.yaml, with AI, once a year (.github/workflows/season-lists.yml, 1 October). Nothing goes
// live by itself: the drafts land in the admin's "Season lists" panel, and approving a town there commits
// content/seasons/<season>/<town>.yaml. So a person checks every list, but nobody types it.
//
//   GEMINI_API_KEY=… node scripts/season-lists.mjs draft [season]   writes SEASON_DRAFTS (default .cache/season-drafts.json)
//   node scripts/season-lists.mjs geocode                           adds map pins to fixture files that lack them
//
// draft reads each list page, asks the model for the rows, then reads each row's own page on the same site
// (up to DETAIL_LIMIT per list) for opening hours, address and what children find there, and pins the rows
// with OpenStreetMap's Nominatim. LIST_MODEL picks the model (src/lib/llm.ts has the defaults).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { load as parseYaml } from "js-yaml";
import { complete, pickLlm } from "../src/lib/llm.ts";
import { loadSeasons } from "../src/lib/seasons.ts";
import { lookup, saveCache } from "./nominatim.mjs";
import { KIDS, cleanItem, uniqueItems } from "../admin/lib/season-lists.js";

const OUT = process.env.SEASON_DRAFTS || ".cache/season-drafts.json";
const DETAIL_LIMIT = Number(process.env.DETAIL_LIMIT) || 30;
const UA = "Mozilla/5.0 (compatible; little-outings season lists; +https://outings.allo.land)";

/** A page's readable text and its links, without scripts, menus' markup or styles. */
export function pageText(html, base) {
  const links = [];
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    try { if (text) links.push({ text: text.slice(0, 80), url: new URL(m[1].replace(/&amp;/g, "&"), base).href }); } catch { /* odd href */ }
  }
  const text = html
    .replace(/<(script|style|noscript|svg|head|nav|footer)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/li|\/h\d|\/tr|\/div|\/td)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ").replace(/ *\n[\s]*/g, "\n").trim();
  return { text, links };
}

async function fetchPage(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return pageText(await res.text(), res.url || url);
}

const KIDS_HELP = `kids: what children find there, only from this list: ${KIDS.join(", ")} (carousel = children's carousel, rides = Ferris wheel or other rides, ice_rink, fairy_tale = fairy-tale theme or characters, crafts = crafts or baking, nativity = nativity scene, animals = petting zoo or ponies, train = children's train, stage = stage, puppet or children's theatre, santa = St. Nicholas or Father Christmas visits)`;

export const LIST_PROMPT = (what, year) => `You read a German city web page that lists ${what}, for the website "Little Outings" where parents find outings with children.
Extract every one that takes place in the ${year} season. Skip anything without dates, and anything clearly from an earlier year.
Return only JSON: {"items": [{"name": "...", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "hours": "short German opening hours or null", "street": "street or square, or null", "district": "Stadtteil or null", "website": "the link to its own page from the links list, or null", ${KIDS_HELP.replace(/^kids/, '"kids": [...]')}, "free": true/false/null for free entry, "note": {"de": "one sentence on what children find there", "en": "the same in English", "zh": "the same in Simplified Chinese"} or null}]}.
Use only facts on the page. Keep names as the page writes them.`;

export const DETAIL_PROMPT = (year) => `You read the web page of one Christmas market, fair or similar, for parents who go with children, for the ${year} season.
Return only JSON: {"from": "YYYY-MM-DD" or null, "to": "YYYY-MM-DD" or null, "hours": "short German opening hours, e.g. \\"So–Mi 11–21, Do–Sa 11–22 Uhr; 22.11. zu\\"" or null, "street": "street, square or address without town" or null, "district": "Stadtteil" or null, ${KIDS_HELP.replace(/^kids/, '"kids": [...]')}, "free": true/false/null for free entry, "note": {"de": "one or two short sentences on what children find there and anything families should know", "en": "...", "zh": "..."} or null}.
Use only facts on the page; null when the page doesn't say.`;

/** The JSON object in a model's answer, or null. */
export function parseJson(text) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/** Fills a row from its own page's answer; the list's values stay where the page says nothing. */
export function mergeDetail(item, detail) {
  if (!detail) return item;
  const out = { ...item };
  for (const k of ["from", "to", "hours", "street", "district", "free"]) if (detail[k] != null && detail[k] !== "") out[k] = detail[k];
  if (Array.isArray(detail.kids) && detail.kids.length) out.kids = [...new Set([...(item.kids ?? []), ...detail.kids])];
  if (detail.note?.de) out.note = detail.note;
  return out;
}

async function draft(only) {
  const llm = pickLlm(process.env);
  if (!llm) { console.log("No GEMINI_API_KEY or ANTHROPIC_API_KEY: nothing drafted."); return; }
  const { seasons, fixtures } = loadSeasons();
  const regions = readdirSync("content/regions").flatMap((f) => parseYaml(readFileSync(`content/regions/${f}`, "utf8")).towns);
  const today = new Date().toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const ask = (system, text) => complete(llm, process.env.LIST_MODEL, { system, text: text.slice(0, 60000), maxTokens: 8000, json: true });
  const drafts = [];
  for (const s of seasons.filter((x) => x.sources?.length && (!only || x.id === only))) {
    const what = typeof s.page?.fixtures === "object" ? s.page.fixtures.de : s.id;
    for (const src of s.sources) {
      const url = src.url.replace("{year}", String(year));
      const town = src.name ?? fixtures.find((f) => f.season === s.id && f.slug === src.town)?.town
        ?? regions.find((t) => t.name.toLowerCase().replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ä/g, "ae").startsWith(src.town))?.name ?? src.town;
      const anchor = regions.find((t) => t.name === town);
      const entry = { season: s.id, town: src.town, townName: town, source: new URL(url).hostname.replace(/^www\./, ""), url, items: [], errors: [] };
      try {
        const page = await fetchPage(url);
        const links = page.links.filter((l) => new URL(l.url).hostname === new URL(url).hostname).slice(0, 300);
        const answer = parseJson(await ask(LIST_PROMPT(what, year), `${page.text}\n\nLINKS:\n${links.map((l) => `${l.text} → ${l.url}`).join("\n")}`));
        let items = (answer?.items ?? []).filter((it) => cleanItem(it) && it.to >= today);
        let read = 0;
        for (const [i, it] of items.entries()) {
          if (!it.website || new URL(it.website).hostname !== new URL(url).hostname || it.website === url || read >= DETAIL_LIMIT) continue;
          read++;
          try {
            const detail = await fetchPage(it.website);
            items[i] = mergeDetail(it, parseJson(await ask(DETAIL_PROMPT(year), detail.text)));
          } catch (error) { entry.errors.push(String(error.message)); }
        }
        for (const it of items) {
          if (!it.street || !anchor) continue;
          const hit = await lookup(`${it.street}, ${town}`, [anchor.lat, anchor.lon, 25]);
          if (hit) it.geo = { lat: Number(hit.lat), lon: Number(hit.lon) };
        }
        entry.items = uniqueItems(items);
      } catch (error) {
        entry.errors.push(String(error.message));
      }
      console.log(`${s.id}/${src.town}: ${entry.items.length} rows${entry.errors.length ? `, ${entry.errors.length} errors` : ""}`);
      drafts.push(entry);
    }
  }
  saveCache();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), drafts }, null, 1) + "\n");
  console.log(`Drafted ${drafts.reduce((n, d) => n + d.items.length, 0)} rows for ${drafts.length} lists into ${OUT}.`);
}

/** Adds `geo:` under the street of every row in the fixture files that has a street but no pin. */
async function geocode() {
  const regions = readdirSync("content/regions").flatMap((f) => parseYaml(readFileSync(`content/regions/${f}`, "utf8")).towns);
  let added = 0;
  for (const season of readdirSync("content/seasons")) {
    for (const name of readdirSync(`content/seasons/${season}`).filter((n) => n.endsWith(".yaml"))) {
      const path = `content/seasons/${season}/${name}`;
      let text = readFileSync(path, "utf8");
      const file = parseYaml(text);
      const anchor = regions.find((t) => t.name === file.town);
      for (const it of file.items ?? []) {
        if (it.geo || !it.street || !anchor) continue;
        const hit = await lookup(`${String(it.street).split(/ und |,/)[0]}, ${file.town}`, [anchor.lat, anchor.lon, 25]);
        if (!hit) { console.log(`  no pin: ${path} ${it.id} (${it.street})`); continue; }
        // The row's own street line, found after its id so two rows on one square stay apart.
        const block = new RegExp(`(\\n  - id: ${it.id}\\n(?:    .*\\n)*?    street: .*\\n)`);
        if (!block.test(text)) continue;
        text = text.replace(block, `$1    geo: { lat: ${(+hit.lat).toFixed(5)}, lon: ${(+hit.lon).toFixed(5)} }\n`);
        added++;
      }
      writeFileSync(path, text);
    }
  }
  saveCache();
  console.log(`Added ${added} pins.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "draft") await draft(arg);
  else if (cmd === "geocode") await geocode();
  else { console.log("Usage: node scripts/season-lists.mjs draft [season] | geocode"); process.exit(1); }
}
