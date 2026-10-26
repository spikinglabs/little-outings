// Toilets, changing tables and drinking water → data/toilets.jsonl, run before every build.
//
//   TOILETS_EXPORT   a URL (or a path) to places/toilets.jsonl in the public places bucket, refreshed monthly
//                    by spikinglabs/osm-family-data. Unset: next to PLACES_EXPORT (…/places/toilets.jsonl).
// When it can't be read, the last downloaded file stays (or none: pages then simply show no toilets).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const OUT = process.env.TOILETS_FILE || "data/toilets.jsonl";

/** Where to read from: TOILETS_EXPORT, or the file beside PLACES_EXPORT. */
export function source(env = process.env) {
  if (env.TOILETS_EXPORT) return env.TOILETS_EXPORT;
  if (env.PLACES_EXPORT && /places\.jsonl$/.test(env.PLACES_EXPORT)) return env.PLACES_EXPORT.replace(/places\.jsonl$/, "toilets.jsonl");
  return "";
}

async function read(from) {
  if (!/^https?:/.test(from)) return readFileSync(from, "utf8");
  const res = await fetch(from, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`answered ${res.status}`);
  return res.text();
}

async function main() {
  const from = source();
  if (!from) return console.log("toilets: no TOILETS_EXPORT or PLACES_EXPORT; skipped");
  try {
    const text = await read(from);
    const rows = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    if (!rows.length) throw new Error("is empty");
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, text);
    console.log(`toilets: ${rows.length} (${rows.filter((r) => r.kind === "toilets").length} toilets) -> ${OUT}`);
  } catch (e) {
    console.log(`::warning title=Toilets::TOILETS_EXPORT ${e.message}; ${existsSync(OUT) ? "keeping the last file" : "no toilets on this build"}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
