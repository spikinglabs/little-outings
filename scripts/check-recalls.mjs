// Product recalls: asks the AI which official German recalls parents should know about (baby food, children's
// food, toys, children's products) and writes them up, every night before the deploy (.github/workflows/translate.yml).
//
// Reads spikinglabs/recall-tracker's daily file (baby and children's recalls from lebensmittelwarnung.de, the US
// FDA and the US CPSC), keeps the German ones from the last RECENT days that were not asked yet, and for each reads
// the official page and writes the product, the reason, the stores, what to check at home (best-before date, lot,
// barcode) and what the page says to do, per language. Writes
//   RECALLS_DIR/recalls.json  every verdict, uploaded back to the bucket so the admin's "Recalls" panel lists them
//   data/recalls.json         the recalls someone confirmed in the admin (recall-decisions.json), until their last day
// Nothing reaches the site without a person's Confirm in the admin.
//
//   GEMINI_API_KEY=… npm run check:recalls      (or ANTHROPIC_API_KEY; see src/lib/llm.ts for the switch)
//   RECALLS_EXPORT=…  the file to read, a URL or a path (default: recall-tracker's latest file)
//   RECALLS_MODEL=…   optional; the provider's default otherwise
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { complete, pickLlm } from "../src/lib/llm.ts";
import { eachLimit } from "../src/lib/pool.ts";
import { readPage } from "./check-alerts.mjs";
import { confirmedRecalls } from "../admin/lib/recalls.js";

const DIR = process.env.RECALLS_DIR || ".cache/outings";
const PUBLISHED = process.env.RECALLS_FILE || "data/recalls.json";
const EXPORT = process.env.RECALLS_EXPORT || "https://pub-f36c3831e82845e4af2d54940ea6c32d.r2.dev/baby/scraped_date%3Dlatest/processed.json";
const AT_ONCE = 3;
/** Days: a recall older than this is not asked about any more (and its verdict is dropped from the store). */
export const RECENT = 30;

/** Bump when the rules below change: every stored recall from an older version is asked again (your decisions stay). */
export const PROMPT_VERSION = 1;

export const KINDS = ["baby_food", "food", "toy", "kids_product", "cosmetics", "other"];

export const DETAIL = `You write product recall notices for "Allo Outings", a website where parents in Germany find outings with their children.
You get one official German recall (title, reason, the states it was sold in) and, when there is one, the text of the official page on lebensmittelwarnung.de.
Answer with only JSON:
{"relevant": "yes" | "no" | "unsure",
 "kind": "baby_food" | "food" | "toy" | "kids_product" | "cosmetics" | "other",
 "product": {"de": "…", "en": "…", "zh": "…"},
 "reason": {"de": "…", "en": "…", "zh": "…"},
 "line": {"de": "…", "en": "…", "zh": "…"},
 "stores": ["Action", "Kaufland"],
 "check": {"de": ["…"], "en": ["…"], "zh": ["…"]},
 "todo": {"de": ["…"], "en": ["…"], "zh": ["…"]}}
- "relevant": "yes" when parents of babies and young children should know: baby food and formula, food made for or popular with children (sweets, snacks, juice, cereals), toys, play sand and slime, children's clothes, dishes and other products for children; "no" for products only adults use.
- "kind": baby_food for formula, baby food and baby snacks; toy for toys, play sand and craft materials; kids_product for other children's products.
- product: the product name with its brand, at most 60 characters; keep brand and product names as they are in every language.
- reason: what is wrong, in plain words, at most 80 characters (for example "may contain mould", "contains too much boron").
- line: one sentence, at most 140 characters: which product, why, and where it was sold.
- stores: the shops or chains named as selling it ("Vertrieb über"); leave empty when the page doesn't say.
- check: up to 4 short items, at most 100 characters each, that tell a parent whether the one at home is affected: best-before dates, lot numbers, barcodes (EAN), sizes, and when an update names only some stores, which ones. Only what the page says. When the page says the list of batches is in a company notice, say that.
- todo: up to 3 short items, at most 120 characters each, with what the page says to do: return it to the store, refund with or without receipt, phone number of the customer service. Only what the page says.
- Facts only, from the recall and page. No reassurance, no opinion, no medical advice beyond what the page says.
- German for "de", English for "en", Simplified Chinese for "zh" (keep German shop and brand names as they are).`;

const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (day, n) => iso(new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5));
const dayOf = (rec) => (typeof rec.publish_datetime === "string" ? rec.publish_datetime.slice(0, 10) : rec.publish_date) || null;

/** German recalls from the last RECENT days, not asked yet with the current rules. */
export function toCheck(records, items, today) {
  const oldest = addDays(today, -RECENT);
  return records.filter((rec) => {
    if (!rec?.id || !rec.title || !rec.url || rec.country_sold_in !== "DE") return false;
    if (items[rec.id]?.v === PROMPT_VERSION) return false;
    const day = dayOf(rec);
    return !!day && day >= oldest && day <= today;
  });
}

/** recall-tracker's company field runs on into the product description; the first line is the name. */
export const companyOf = (rec) => (typeof rec.company === "string" ? rec.company.split(/\n|Produktbezeichnung/)[0].replace(/[,\s]+$/, "").trim().slice(0, 80) : "");

/** What the model reads about one recall besides the page: facts only. */
export function describe(rec) {
  const reason = typeof rec.reason === "object" && rec.reason ? rec.reason.de || rec.reason.en : rec.reason;
  return Object.fromEntries(Object.entries({
    title: rec.title, published: dayOf(rec), reason, company: companyOf(rec) || undefined,
    states: rec.location_sold_in?.length === 16 ? "all of Germany" : rec.location_sold_in?.join(", "),
  }).filter(([, v]) => v !== undefined && v !== ""));
}

function jsonOf(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

const clip = (s, n) => (typeof s === "string" ? s.trim().slice(0, n) : "");
const LANGS = ["de", "en", "zh"];
const perLang = (v, n) => {
  const out = Object.fromEntries(LANGS.map((l) => [l, clip(v?.[l], n)]));
  return LANGS.every((l) => out[l]) ? out : null;
};
const listPerLang = (v, max, n) => {
  const out = Object.fromEntries(LANGS.map((l) => [l, (Array.isArray(v?.[l]) ? v[l] : []).map((x) => clip(x, n)).filter(Boolean).slice(0, max)]));
  return LANGS.every((l) => out[l].length) ? out : null;
};

/** The answer, checked: product, reason and line in all three languages unless it is a "no". Null when unusable. */
export function parseDetail(text) {
  const a = jsonOf(text);
  if (!a || !["yes", "no", "unsure"].includes(a.relevant)) return null;
  if (a.relevant === "no") return { relevant: "no" };
  const product = perLang(a.product, 80);
  const reason = perLang(a.reason, 100);
  const line = perLang(a.line, 160);
  if (!product || !reason || !line) return null;
  const stores = (Array.isArray(a.stores) ? a.stores : []).map((x) => clip(x, 40)).filter(Boolean).slice(0, 8);
  const check = listPerLang(a.check, 4, 120);
  const todo = listPerLang(a.todo, 3, 140);
  return {
    relevant: a.relevant,
    kind: KINDS.includes(a.kind) ? a.kind : "other",
    product, reason, line,
    ...(stores.length ? { stores } : {}),
    ...(check ? { check } : {}),
    ...(todo ? { todo } : {}),
  };
}

/** Reads the official page and asks for the write-up. Null when it failed (asked again next night). */
export async function detail(rec, llm, model, { ask = complete, fetchFn = globalThis.fetch } = {}) {
  const page = await readPage(rec.url, fetchFn);
  const text = JSON.stringify({ recall: describe(rec) }) + (page ? `\n\nOfficial page:\n${page}` : "");
  try {
    return parseDetail(await ask(llm, model, { system: DETAIL, text, maxTokens: 3000, json: true }));
  } catch {
    return null;
  }
}

/** One stored item: the facts, and the AI's verdict and texts. Your decision lives in recall-decisions.json. */
export function itemOf(rec, found, now) {
  const { relevant, ...texts } = found;
  return {
    id: rec.id,
    title: rec.title,
    url: rec.url,
    published: dayOf(rec),
    ...(rec.location_sold_in?.length ? { states: rec.location_sold_in.length === 16 ? "all" : rec.location_sold_in } : {}),
    ...(companyOf(rec) ? { company: companyOf(rec) } : {}),
    verdict: relevant,
    ...texts,
    checked_at: now,
    v: PROMPT_VERSION,
  };
}

/** Verdicts older than RECENT days go, unless you confirmed it and its last day is still to come. */
export function prune(items, decisions, today) {
  const oldest = addDays(today, -RECENT);
  return Object.fromEntries(Object.entries(items).filter(([id, it]) => {
    const d = decisions?.recalls?.[id];
    if (d?.status === "confirmed" && (d.until || addDays(it.published, RECENT)) >= today) return true;
    return (it.published || "") >= oldest;
  }));
}

async function readExport(source) {
  if (!/^https?:/.test(source)) return existsSync(source) ? readFileSync(source, "utf8") : null;
  const res = await fetch(source, { headers: { "user-agent": "little-outings recalls (+https://outings.allo.land)" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${source}`);
  return res.text();
}

const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);

/** data/recalls.json: what the site shows. Written only when it changed. */
function publish(store, decisions, today) {
  const after = JSON.stringify({ recalls: confirmedRecalls(store, decisions, today) }, null, 2) + "\n";
  const before = existsSync(PUBLISHED) ? readFileSync(PUBLISHED, "utf8") : "";
  if (after !== before) writeFileSync(PUBLISHED, after);
  return JSON.parse(after).recalls.length;
}

async function main() {
  const today = process.env.RECALLS_TODAY || iso(new Date());
  const store = readJson(`${DIR}/recalls.json`, { schema_version: 1, items: {} });
  const decisions = readJson(`${DIR}/recall-decisions.json`, null);
  store.items = prune(store.items, decisions, today);

  let records = [];
  let note;
  try {
    const text = await readExport(EXPORT);
    records = text ? JSON.parse(text) : [];
  } catch (e) {
    console.log(`::warning title=Recalls::could not read recall-tracker's file: ${e.message}`);
  }
  const todo = toCheck(Array.isArray(records) ? records : [], store.items, today);
  const llm = pickLlm(process.env);
  if (!records.length) note = "no recall-tracker file";
  else if (!todo.length) note = `${records.length} recalls, nothing new in Germany`;
  else if (!llm) note = `${todo.length} new recalls not checked (no GEMINI_API_KEY or ANTHROPIC_API_KEY)`;
  else {
    const now = new Date().toISOString();
    let flagged = 0, done = 0;
    await eachLimit(todo, AT_ONCE, async (rec) => {
      const found = await detail(rec, llm, process.env.RECALLS_MODEL);
      if (!found) return; // asked again next night
      store.items[rec.id] = itemOf(rec, found, now);
      done++;
      if (found.relevant !== "no") flagged++;
    });
    note = `checked ${done} of ${todo.length} new German recalls; ${flagged} for the admin to confirm`;
  }
  store.updated_at = new Date().toISOString();
  writeFileSync(`${DIR}/recalls.json`, JSON.stringify(store));
  const shown = publish(store, decisions, today);
  console.log(`recalls: ${note}; ${shown} confirmed recalls on the site`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
