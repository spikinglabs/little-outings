// City alerts: rare things in a big city that parents should know before they go out (a big demo, an
// evacuation, a transit strike). spikinglabs/city-anomalies collects the facts from official sources;
// the nightly scripts/check-alerts.mjs asks the AI whether each one matters to families and stores the
// verdicts in the bucket (little-outings/alerts.json); the admin's "City alerts" panel confirms or drops
// them (little-outings/alert-decisions.json), and only confirmed ones reach the site as data/alerts.json.
// Like candidates and decisions, each file has one writer, so the nightly run never undoes a click.
// Plain JS: the admin, the script and the tests share it.

/** A per-language field with your changes laid over the AI's, or nothing when neither has it. */
const lang = (it, d, key) => (it[key] || d[key] ? { [key]: { ...it[key], ...d[key] } } : {});

/** Each item with your decision laid over the AI's: status, and any line, day or time you changed. */
export function mergedAlerts(store, decisions) {
  return Object.values(store?.items || {}).map((it) => {
    const d = decisions?.alerts?.[it.id];
    if (!d) return { ...it, status: "new" };
    return { ...it, ...d, line: { ...it.line, ...d.line }, ...lang(it, d, "about"), ...lang(it, d, "points") };
  });
}

/** What the site shows of a confirmed alert: our own lines, background and key points, the facts, and the official link. */
export function publicAlert(item) {
  return {
    id: item.id,
    city: item.city,
    day: item.day,
    ...(item.until && item.until !== item.day ? { until: item.until } : {}),
    ...(item.from ? { from: item.from } : {}),
    ...(item.to ? { to: item.to } : {}),
    kind: item.kind,
    ...(item.type ? { type: item.type } : {}),
    ...(item.expected ? { expected: item.expected } : {}),
    ...(item.where ? { where: item.where } : {}),
    ...(item.route ? { route: item.route } : {}),
    ...(item.lines?.length ? { lines: item.lines } : {}),
    line: item.line,
    ...(item.about?.de && item.about?.en && item.about?.zh ? { about: item.about } : {}),
    ...(item.points?.de?.length && item.points?.en?.length && item.points?.zh?.length ? { points: item.points } : {}),
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
const ABOUT_MAX = 300;
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
  if (body.about) {
    const about = { ...before.about };
    for (const l of ["de", "en", "zh"]) {
      if (typeof body.about[l] !== "string") continue;
      const text = body.about[l].trim();
      if (text.length > ABOUT_MAX) throw new Error(`The ${l} background must be at most ${ABOUT_MAX} characters.`);
      if (text === (item.about?.[l] ?? "")) delete about[l];
      else about[l] = text;
    }
    if (Object.keys(about).length) d.about = about;
    else delete d.about;
  }
  if (body.points) {
    const points = { ...before.points };
    for (const l of ["de", "en", "zh"]) {
      if (!Array.isArray(body.points[l])) continue;
      const list = body.points[l].map((x) => String(x).trim()).filter(Boolean);
      if (list.length > 6 || list.some((x) => x.length > LINE_MAX)) throw new Error(`The ${l} points must be at most 6, each at most ${LINE_MAX} characters.`);
      if (JSON.stringify(list) === JSON.stringify(item.points?.[l] ?? [])) delete points[l];
      else points[l] = list;
    }
    if (Object.keys(points).length) d.points = points;
    else delete d.points;
  }
  if ("expected" in body) {
    const n = body.expected === "" || body.expected === null ? null : Number(body.expected);
    if (n !== null && !(Number.isInteger(n) && n > 0)) throw new Error("expected must be a whole number of people.");
    if (n && n !== item.expected) d.expected = n;
    else delete d.expected;
  }
  for (const key of ["route", "where"]) {
    if (typeof body[key] !== "string") continue;
    const text = body[key].trim();
    if (text.length > 300) throw new Error(`${key} must be at most 300 characters.`);
    if (text && text !== item[key]) d[key] = text;
    else delete d[key];
  }
  if (Array.isArray(body.lines)) {
    const list = body.lines.map((x) => String(x).trim()).filter(Boolean).slice(0, 12);
    if (JSON.stringify(list) !== JSON.stringify(item.lines ?? [])) d.lines = list;
    else delete d.lines;
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
