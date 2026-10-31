// Product recalls: official German recalls of baby food, children's food, toys and children's products.
// spikinglabs/recall-tracker collects them daily from lebensmittelwarnung.de; the nightly scripts/check-recalls.mjs
// asks the AI whether each matters to families and writes it up, into the bucket (little-outings/recalls.json);
// the admin's "Recalls" panel confirms or drops them (little-outings/recall-decisions.json), and only confirmed
// ones reach the site as data/recalls.json, until their last day (SHOW_DAYS after the recall, unless you set one).
// Like the city alerts, each file has one writer, so the nightly run never undoes a click.
// Plain JS: the admin, the script and the tests share it.

export const SHOW_DAYS = 30;
const LANGS = ["de", "en", "zh"];
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** The last day a recall shows on the site. */
export const lastDay = (it) => it.until || (it.published ? addDays(it.published, SHOW_DAYS) : "");

const lang = (it, d, key) => (it[key] || d[key] ? { [key]: { ...it[key], ...d[key] } } : {});

/** Each item with your decision laid over the AI's: status, and any text you changed. */
export function mergedRecalls(store, decisions) {
  return Object.values(store?.items || {}).map((it) => {
    const d = decisions?.recalls?.[it.id];
    if (!d) return { ...it, status: "new" };
    return { ...it, ...d, ...["product", "reason", "line", "check", "todo"].reduce((o, k) => ({ ...o, ...lang(it, d, k) }), {}) };
  });
}

const full = (v) => LANGS.every((l) => (Array.isArray(v?.[l]) ? v[l].length : v?.[l]));

/** What the site shows of a confirmed recall: our texts, the facts, and the official link. */
export function publicRecall(item) {
  return {
    id: item.id,
    published: item.published,
    until: lastDay(item),
    kind: item.kind || "other",
    product: item.product,
    reason: item.reason,
    line: item.line,
    ...(item.stores?.length ? { stores: item.stores } : {}),
    ...(item.states ? { states: item.states } : {}),
    ...(item.company ? { company: item.company } : {}),
    ...(full(item.check) ? { check: item.check } : {}),
    ...(full(item.todo) ? { todo: item.todo } : {}),
    url: item.url,
  };
}

/** The confirmed recalls still to show, newest first: the content of data/recalls.json. */
export function confirmedRecalls(store, decisions, today) {
  return mergedRecalls(store, decisions)
    .filter((it) => it.status === "confirmed" && it.published && lastDay(it) >= today)
    .sort((a, b) => b.published.localeCompare(a.published) || a.id.localeCompare(b.id))
    .map(publicRecall);
}

/** What the admin lists: what the AI kept (yes, unsure) or you confirmed, newest first. */
export function recallsToCheck(store, decisions, today) {
  return mergedRecalls(store, decisions)
    .filter((it) => it.status === "confirmed" ? lastDay(it) >= today : it.status === "new" && it.verdict !== "no")
    .sort((a, b) => (b.published || "").localeCompare(a.published || "") || a.id.localeCompare(b.id));
}

const MAX = { product: 80, reason: 100, line: 160 };
const LIST_MAX = { check: [6, 140], todo: [4, 160] };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One admin answer on one recall: confirm, drop or reopen ("new"), with optional changed texts, stores or last day.
 * Returns the new decisions; decisions on recalls the nightly run no longer has are dropped.
 */
export function applyRecallDecision(store, decisions, body, user, now = new Date().toISOString()) {
  const item = store?.items?.[body?.id];
  if (!item) throw new Error("No such recall.");
  if (!["confirmed", "dropped", "new"].includes(body.status)) throw new Error("status must be confirmed, dropped or new.");
  const before = decisions?.recalls?.[item.id] || {};
  const d = { ...before, status: body.status, decided_by: user?.email || null, decided_at: now };
  for (const [key, max] of Object.entries(MAX)) {
    if (!body[key]) continue;
    const next = { ...before[key] };
    for (const l of LANGS) {
      if (typeof body[key][l] !== "string") continue;
      const text = body[key][l].trim();
      if (!text || text.length > max) throw new Error(`The ${l} ${key} must be 1 to ${max} characters.`);
      if (text === item[key]?.[l]) delete next[l];
      else next[l] = text;
    }
    if (Object.keys(next).length) d[key] = next;
    else delete d[key];
  }
  for (const [key, [count, max]] of Object.entries(LIST_MAX)) {
    if (!body[key]) continue;
    const next = { ...before[key] };
    for (const l of LANGS) {
      if (!Array.isArray(body[key][l])) continue;
      const list = body[key][l].map((x) => String(x).trim()).filter(Boolean);
      if (list.length > count || list.some((x) => x.length > max)) throw new Error(`The ${l} ${key} list must be at most ${count} items, each at most ${max} characters.`);
      if (JSON.stringify(list) === JSON.stringify(item[key]?.[l] ?? [])) delete next[l];
      else next[l] = list;
    }
    if (Object.keys(next).length) d[key] = next;
    else delete d[key];
  }
  if (Array.isArray(body.stores)) {
    const list = body.stores.map((x) => String(x).trim()).filter(Boolean).slice(0, 8);
    if (JSON.stringify(list) !== JSON.stringify(item.stores ?? [])) d.stores = list;
    else delete d.stores;
  }
  if ("until" in body) {
    const value = typeof body.until === "string" ? body.until.trim() : "";
    if (value && !DAY.test(value)) throw new Error("until must look like 2026-11-30.");
    if (value && item.published && value < item.published) throw new Error("until must not be before the recall.");
    if (value && value !== addDays(item.published, SHOW_DAYS)) d.until = value;
    else delete d.until;
  }
  const merged = mergedRecalls({ items: { [item.id]: item } }, { recalls: { [item.id]: d } })[0];
  if (d.status === "confirmed" && !(full(merged.product) && full(merged.reason) && full(merged.line) && merged.published)) {
    throw new Error("A recall needs the product, reason and line in German, English and Chinese before it can be confirmed.");
  }
  const recalls = Object.fromEntries(Object.entries(decisions?.recalls || {}).filter(([id]) => store.items[id]));
  return { schema_version: 1, recalls: { ...recalls, [item.id]: d } };
}
