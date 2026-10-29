// Weekly totals for the Usage panel, from the site's anonymous daily counts (/api/hit on the site).
// Pure, so tests/admin.test.mjs can check it; usage.js draws the table.

/** What each counted action means, in the order the panel lists them. */
export const ACTIONS = [
  ["from_wechat", "Opened inside WeChat"],
  ["share", "Tapped Share"],
  ["copy", "Copied a link or the weekend text"],
  ["save", "Saved an outing"],
  ["maps", "Opened directions"],
  ["calendar", "Added to calendar"],
  ["website", "Opened the organiser's website"],
  ["install", "Installed the app"],
  ["share_image", "Shared or saved a picture card"],
  ["rednote_share", "Shared to Rednote"],
  ["from_rednote", "Typed a Rednote card code"],
  ["from_telegram", "Came from Telegram"],
  ["from_print", "Came from the printed sheet"],
];

const DAY = 86400_000;
/** The Monday that starts the week of `day` (YYYY-MM-DD). */
export function mondayOf(day) {
  const t = Date.parse(`${day}T00:00:00Z`);
  const back = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - back * DAY).toISOString().slice(0, 10);
}

/**
 * Rows of { day, event, lang, n } summed per action and week, newest week first.
 * `lang` keeps one language ("de" | "en" | "zh"); anything else counts them all.
 */
export function weeklyUsage(rows, today, { weeks = 4, lang = "" } = {}) {
  const first = mondayOf(today);
  const starts = Array.from({ length: weeks }, (_, i) => new Date(Date.parse(`${first}T00:00:00Z`) - i * 7 * DAY).toISOString().slice(0, 10));
  const known = new Map(ACTIONS);
  const sums = new Map();
  for (const r of rows) {
    if (lang && r.lang !== lang) continue;
    const col = starts.indexOf(mondayOf(r.day));
    if (col < 0) continue;
    if (!sums.has(r.event)) sums.set(r.event, Array(weeks).fill(0));
    sums.get(r.event)[col] += Number(r.n) || 0;
  }
  const order = [...ACTIONS.map(([e]) => e), ...[...sums.keys()].filter((e) => !known.has(e)).sort()];
  return {
    weeks: starts,
    rows: order.filter((e) => sums.has(e)).map((e) => ({ event: e, label: known.get(e) ?? e, counts: sums.get(e) })),
  };
}
