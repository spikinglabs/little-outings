// City alerts: rare things in a big city that parents should know before they go out (a big demo, an
// evacuation, a transit strike). spikinglabs/city-anomalies collects the facts from official sources;
// the nightly scripts/check-alerts.mjs asks the AI whether each one matters to families and stores the
// verdicts in the bucket (little-outings/alerts.json); the admin's "City alerts" panel confirms or drops
// them (little-outings/alert-decisions.json), and only confirmed ones reach the site as data/alerts.json.
// Like candidates and decisions, each file has one writer, so the nightly run never undoes a click.
// Plain JS: the admin, the script and the tests share it.

/** Each item with your decision laid over the AI's: status, and any line, day or time you changed. */
export function mergedAlerts(store, decisions) {
  return Object.values(store?.items || {}).map((it) => {
    const d = decisions?.alerts?.[it.id];
    if (!d) return { ...it, status: "new" };
    return { ...it, ...d, line: { ...it.line, ...d.line } };
  });
}

/** What the site shows of a confirmed alert: our own short lines and facts, plus the official link. */
export function publicAlert(item) {
  return {
    id: item.id,
    city: item.city,
    day: item.day,
    ...(item.until && item.until !== item.day ? { until: item.until } : {}),
    ...(item.from ? { from: item.from } : {}),
    ...(item.to ? { to: item.to } : {}),
    kind: item.kind,
    line: item.line,
    url: item.url,
  };
}

/** The confirmed alerts that are not over yet, soonest first: the content of data/alerts.json. */
export function confirmedAlerts(store, decisions, today) {
  return mergedAlerts(store, decisions)
    .filter((it) => it.status === "confirmed" && it.day && (it.until || it.day) >= today)
    .sort((a, b) => a.day.localeCompare(b.day) || (a.from || "").localeCompare(b.from || "") || a.id.localeCompare(b.id))
    .map(publicAlert);
}

/** What the admin lists: what the AI kept (yes, unsure) or you already confirmed, not over yet. */
export function alertsToCheck(store, decisions, today) {
  return mergedAlerts(store, decisions)
    .filter((it) => (it.until || it.day || today) >= today)
    .filter((it) => it.status === "confirmed" || (it.status === "new" && it.verdict !== "no"))
    .sort((a, b) => (a.day || "9").localeCompare(b.day || "9") || a.id.localeCompare(b.id));
}

const LINE_MAX = 160;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * One admin answer on one alert: confirm, drop or reopen ("new"), with optional changed lines, day or times.
 * Returns the new decisions; decisions on alerts the nightly run no longer has are dropped.
 */
export function applyAlertDecision(store, decisions, body, user, now = new Date().toISOString()) {
  const item = store?.items?.[body?.id];
  if (!item) throw new Error("No such alert.");
  if (!["confirmed", "dropped", "new"].includes(body.status)) throw new Error("status must be confirmed, dropped or new.");
  const before = decisions?.alerts?.[item.id] || {};
  const d = { ...before, status: body.status, decided_by: user?.email || null, decided_at: now };
  if (body.line) {
    const line = { ...before.line };
    for (const lang of ["de", "en", "zh"]) {
      if (typeof body.line[lang] !== "string") continue;
      const text = body.line[lang].trim();
      if (!text || text.length > LINE_MAX) throw new Error(`The ${lang} line must be 1 to ${LINE_MAX} characters.`);
      if (text === item.line?.[lang]) delete line[lang];
      else line[lang] = text;
    }
    if (Object.keys(line).length) d.line = line;
    else delete d.line;
  }
  for (const [key, re] of [["day", DAY], ["until", DAY], ["from", TIME], ["to", TIME]]) {
    if (!(key in body)) continue;
    const value = typeof body[key] === "string" ? body[key].trim() : "";
    if (value && !re.test(value)) throw new Error(`${key} must look like ${re === DAY ? "2026-10-31" : "14:00"}.`);
    if (value && value !== item[key]) d[key] = value;
    else delete d[key];
  }
  const merged = { ...item, ...d, line: { ...item.line, ...d.line } };
  if (merged.until && merged.day && merged.until < merged.day) throw new Error("until must not be before day.");
  if (d.status === "confirmed" && !(merged.line?.de && merged.line?.en && merged.line?.zh && merged.day)) {
    throw new Error("An alert needs a day and a line in German, English and Chinese before it can be confirmed.");
  }
  const alerts = Object.fromEntries(Object.entries(decisions?.alerts || {}).filter(([id]) => store.items[id]));
  return { schema_version: 1, alerts: { ...alerts, [item.id]: d } };
}
