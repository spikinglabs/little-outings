// Turns cityklub candidates plus the admin's decisions into the published outings list.
// Shared by the admin page (preview) and functions/api/publish.js (the real thing).

/** Fields an admin may correct. Location fields live under row.location. */
export const EDITABLE = ["title", "venue", "time_text", "price_text"];
export const EDITABLE_LOCATION = ["street", "house_number", "postal_code", "city"];

/** Starting keywords until the admin saves their own list; matched inside folded words. */
export const DEFAULT_KEYWORDS = [
  "kind", "kids", "famili", "baby", "eltern", "kita", "schueler", "jugend", "ferien", "puppen",
  "maerchen", "vorlese", "bilderbuch", "mitmach", "basteln", "zoo", "tierpark", "zirkus",
  "laterne", "bauernhof", "hoffest", "spielplatz",
];

export function emptyDecisions() {
  return { schema_version: 1, sources: {}, events: {} };
}

/** The admin's keywords, else the defaults. */
export function keywordsOf(decisions) {
  return Array.isArray(decisions.keywords) ? decisions.keywords : DEFAULT_KEYWORDS;
}

/** Whether cityklub's own family detection (descriptions, categories, farm sources) counts too. */
export function usesDetected(decisions) {
  return decisions.use_detected !== false;
}

const hayCache = new WeakMap();
function keywordHay(row) {
  let hay = hayCache.get(row);
  if (hay === undefined) hay = fold([row.title, row.venue].filter(Boolean).join(" "));
  hayCache.set(row, hay);
  return hay;
}

/** cityklub signals the admin can't re-check itself: description text, categories, farm sources. */
const DETECTED = /^(description|category|source):/;

/**
 * Why a row counts as a family outing: the admin's keywords found in its title or venue,
 * plus "detected" when cityklub saw a family signal in what the candidates file leaves out.
 */
export function familyMatch(row, decisions, edits = {}) {
  const hay = edits.title || edits.venue
    ? fold([edits.title ?? row.title, edits.venue ?? row.venue].filter(Boolean).join(" "))
    : keywordHay(row);
  const words = keywordsOf(decisions).map(fold).filter((word) => word && hay.includes(word));
  const detected = usesDetected(decisions) && (row.family_signals || []).some((s) => DETECTED.test(s));
  return { matched: words.length > 0 || detected, words, detected };
}

/** "include" | "exclude": the admin's choice, else cleared sources are in by default. */
export function sourceMode(sourceId, cleared, decisions) {
  const chosen = decisions.sources?.[sourceId];
  if (chosen === "include" || chosen === "exclude") return chosen;
  return cleared ? "include" : "exclude";
}

/** Whether a row will be published, and why: own choice, then source, then keywords. */
export function rowState(row, decisions) {
  const entry = decisions.events?.[row.event_id];
  if (entry?.visibility === "show") return { published: true, reason: "shown by you" };
  if (entry?.visibility === "hide") return { published: false, reason: "hidden by you" };
  if (sourceMode(row.source_id, row.cleared, decisions) !== "include") {
    return { published: false, reason: "source excluded" };
  }
  return familyMatch(row, decisions, entry?.edits).matched
    ? { published: true, reason: "keyword match" }
    : { published: false, reason: "no keyword match" };
}

export function applyEdits(row, edits = {}) {
  const out = { ...row, location: { ...(row.location || {}) } };
  for (const key of EDITABLE) if (typeof edits[key] === "string") out[key] = edits[key].trim() || undefined;
  for (const key of EDITABLE_LOCATION) {
    const value = edits.location?.[key];
    if (typeof value === "string") out.location[key] = value.trim() || undefined;
  }
  // A corrected street makes old coordinates untrustworthy unless they were also given.
  if (edits.location?.street !== undefined && edits.location?.latitude === undefined) {
    delete out.location.latitude;
    delete out.location.longitude;
  }
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  for (const key of Object.keys(out.location)) if (out.location[key] === undefined) delete out.location[key];
  return out;
}

/** The rows the site imports: decisions applied, admin-only fields removed. */
export function publishRows(candidates, decisions) {
  const rows = [];
  for (const row of candidates) {
    if (!rowState(row, decisions).published) continue;
    const edited = applyEdits(row, decisions.events?.[row.event_id]?.edits);
    const { also_listed, cleared, family, family_signals, ...publicRow } = edited;
    rows.push({ ...publicRow, family: true });
  }
  return rows;
}

/** Per-source counts for the sources table. */
export function sourceSummary(candidates, decisions) {
  const sources = new Map();
  for (const row of candidates) {
    const entry = sources.get(row.source_id) || {
      id: row.source_id,
      name: row.source_name || row.source_id,
      cleared: row.cleared,
      candidates: 0,
      published: 0,
    };
    entry.cleared = entry.cleared && row.cleared;
    entry.candidates++;
    if (rowState(row, decisions).published) entry.published++;
    sources.set(row.source_id, entry);
  }
  return [...sources.values()]
    .map((entry) => ({ ...entry, mode: sourceMode(entry.id, entry.cleared, decisions) }))
    .sort((a, b) => b.candidates - a.candidates || a.name.localeCompare(b.name));
}

/** Lower-case, German umlauts spelled out and other accents dropped, so "dueren" finds "Düren". */
export function fold(text) {
  return String(text ?? "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Whether every word of the query appears in the row's title, venue, address, source or date. */
export function matchesSearch(row, query, edits = {}) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const loc = row.location || {};
  const hay = fold([
    row.title, edits.title, row.venue, edits.venue, loc.city, loc.district, loc.postal_code, loc.street,
    edits.location?.city, edits.location?.street, row.source_name, row.source_id, row.start_date,
  ].filter(Boolean).join(" "));
  return words.every((w) => hay.includes(w));
}

export function parseJsonl(text) {
  return text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
}

export function toJsonl(rows) {
  return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
}
