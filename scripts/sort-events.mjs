// Sorts new events into "for families" or not with AI, then publishes, every night before the deploy
// (.github/workflows/translate.yml). It does what the admin's Publish button does, so nobody has to.
//
// Reads what the workflow downloaded from the Little Outings bucket (candidates, the admin's decisions and
// the earlier verdicts), asks the model about every title + venue it hasn't judged yet, and writes
//   SORTED_FILE         the verdicts, uploaded back to the bucket so the admin shows them
//   data/outings.jsonl  the published list, exactly as the admin's Publish would write it
// Your own Show / Hide in the admin always wins, and excluded sources stay out. "unsure" events are not
// published; the admin lists them under "Check these". Events the AI hasn't judged yet (no key, or more
// than SORT_LIMIT new ones) fall back to the admin's keywords, as before.
//
//   GEMINI_API_KEY=… npm run sort:events      (or ANTHROPIC_API_KEY; see src/lib/llm.ts for the switch)
//   SORT_MODEL=…                              optional; the provider's default otherwise
//   SORT_LIMIT=…                              new titles sorted per night at most (default 3000), to cap the cost
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { complete, pickLlm } from "../src/lib/llm.ts";
import { emptyDecisions, parseJsonl, publishRows, sortKey, sourceMode, toJsonl } from "../admin/public/apply.js";

const DIR = process.env.SORT_DIR || ".cache/outings";
const PUBLISHED = process.env.OUTINGS_FILE || "data/outings.jsonl";
const LIMIT = Number(process.env.SORT_LIMIT) || 3000; // new titles judged per night at most
const BATCH = 50;

export const PROMPT = `You sort events for "Little Outings", a website where parents in Germany find outings to do with their children.
You get a JSON list of events (title, venue, source, and hints such as "source:" for a source that only lists family events). Most are German.
For each event decide if it belongs on the site:
- "yes": made for children (about 0-12) or families, or a parent would happily take young children: children's theatre, puppet shows, story time, kids' workshops and courses, family tours, children's concerts, zoo and farm days, Kinderflohmarkt, holiday camps, lantern walks, family festivals.
- "no": aimed at adults or teenagers only: lectures, adult courses and talks, language cafés, parent-only evenings, nightlife, parties, business, senior events, most concerts, theatre and exhibitions for adults, sport for adults. Also "no" when only the venue sounds family-like (a "Haus der Familie" or a children's library hosting an adult course).
- "unsure": the title doesn't tell, e.g. a bare exhibition name, a festival or market that may or may not suit children.
Return only JSON: {"answers": [{"i": 0, "f": "yes"}, ...]} with one answer per event, f being "yes", "no" or "unsure".`;

/** Events worth judging: from included sources, without your own Show/Hide, not judged yet. One per title + venue. */
export function toSort(candidates, decisions, verdicts) {
  const seen = new Map();
  for (const row of candidates) {
    if (decisions.events?.[row.event_id]?.visibility) continue;
    if (sourceMode(row.source_id, row.cleared, decisions) !== "include") continue;
    const key = sortKey(row);
    if (verdicts[key] || seen.has(key)) continue;
    seen.set(key, row);
  }
  return [...seen.entries()].map(([key, row]) => ({ key, row }));
}

/** What the model reads about one event: facts only, short. */
export function describe(row, i) {
  const hints = (row.family_signals || []).filter((s) => /^(source|category):/.test(s));
  return {
    i,
    title: row.title,
    ...(row.venue ? { venue: row.venue } : {}),
    source: row.source_name || row.source_id,
    ...(hints.length ? { hints } : {}),
  };
}

/** The model's answers as {index: verdict}; anything odd is dropped and asked again next night. */
export function parseAnswers(text, count) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return {};
  let body;
  try {
    body = JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
  const out = {};
  for (const a of Array.isArray(body.answers) ? body.answers : []) {
    if (Number.isInteger(a?.i) && a.i >= 0 && a.i < count && ["yes", "no", "unsure"].includes(a.f)) out[a.i] = a.f;
  }
  return out;
}

/** Judges `items` in batches; returns the new verdicts and the first error, if any stopped it. */
export async function sortItems(items, llm, model, ask = complete) {
  const verdicts = {};
  for (let at = 0; at < items.length; at += BATCH) {
    const batch = items.slice(at, at + BATCH);
    let text;
    try {
      text = await ask(llm, model, {
        system: PROMPT,
        text: JSON.stringify(batch.map(({ row }, i) => describe(row, i))),
        maxTokens: 4000,
        json: true,
      });
    } catch (error) {
      return { verdicts, error };
    }
    const answers = parseAnswers(text, batch.length);
    batch.forEach(({ key }, i) => { if (answers[i]) verdicts[key] = answers[i]; });
  }
  return { verdicts, error: null };
}

/** Verdicts for titles still among the candidates; the rest are past events. */
export function prune(verdicts, candidates) {
  const live = new Set(candidates.map(sortKey));
  return Object.fromEntries(Object.entries(verdicts).filter(([key]) => live.has(key)));
}

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

async function main() {
  const candidatesFile = `${DIR}/candidates.jsonl`;
  if (!existsSync(candidatesFile)) {
    console.log("sort: no candidates downloaded; nothing published.");
    return;
  }
  const candidates = parseJsonl(readFileSync(candidatesFile, "utf8"));
  if (!candidates.length) {
    console.log("sort: the candidates list is empty; nothing published.");
    return;
  }
  const decisions = readJson(`${DIR}/decisions.json`, emptyDecisions());
  const manifest = readJson(`${DIR}/candidates.json`, null);
  const sorted = readJson(`${DIR}/sorted.json`, { schema_version: 1, verdicts: {} });

  const todo = toSort(candidates, decisions, sorted.verdicts);
  const llm = pickLlm(process.env);
  let note = "";
  if (!todo.length) note = "nothing new to sort";
  else if (!llm) note = `${todo.length} titles not sorted (no GEMINI_API_KEY or ANTHROPIC_API_KEY)`;
  else {
    const { verdicts, error } = await sortItems(todo.slice(0, LIMIT), llm, process.env.SORT_MODEL);
    Object.assign(sorted.verdicts, verdicts);
    const counts = { yes: 0, no: 0, unsure: 0 };
    for (const v of Object.values(verdicts)) counts[v]++;
    note = `sorted ${Object.keys(verdicts).length} of ${todo.length} new titles (${counts.yes} yes, ${counts.no} no, ${counts.unsure} unsure)`;
    if (error) console.log(`::warning title=Sort events::stopped early: ${error.message}`);
  }
  sorted.verdicts = prune(sorted.verdicts, candidates);
  sorted.updated_at = new Date().toISOString();
  writeFileSync(`${DIR}/sorted.json`, JSON.stringify(sorted));

  const rows = publishRows(candidates, decisions, sorted);
  const before = existsSync(PUBLISHED) ? readFileSync(PUBLISHED, "utf8") : "";
  const beforeCount = before.split("\n").filter(Boolean).length;
  // A broken night (an empty or half-written candidates file) must not empty the site.
  if (rows.length < beforeCount / 2 && process.env.SORT_FORCE !== "1") {
    console.log(`::warning title=Sort events::would drop from ${beforeCount} to ${rows.length} outings; kept the old list. Publish from the admin to accept it.`);
    console.log(`sort: ${note}; kept ${beforeCount} outings`);
    return;
  }
  const after = toJsonl(rows);
  if (after !== before) {
    writeFileSync(PUBLISHED, after);
    writeFileSync(`${DIR}/last-publish.json`, JSON.stringify({
      published_at: new Date().toISOString(),
      published_by: "nightly sort",
      count: rows.length,
      candidates_generated_at: manifest?.generated_at || null,
      commit_url: null,
    }, null, 2));
  }
  console.log(`sort: ${note}; ${rows.length} outings published${after === before ? " (unchanged)" : ""}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
