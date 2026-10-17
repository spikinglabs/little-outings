// School holidays for the states our towns are in → data/school-holidays.json, for Discover's
// "Holidays" choice. Dates come from the OpenHolidays API (openholidaysapi.org, free, no key).
// The file is committed and covers this year and the next two; run it again once a year or so.
//
//   npm run fetch:holidays
import { writeFileSync } from "node:fs";

export const OUT = "data/school-holidays.json";
// The states of the towns in content/regions (each town's `state`, or its region's).
const STATES = ["NW", "BE", "BY", "HE", "HH"];

const DAY = 864e5;
/**
 * One state's holidays as { start, end, name } (German name, inclusive dates), oldest first.
 * Only real holidays of three days or more: single free days (Brückentag, Buß- und Bettag,
 * a one-day Pfingstferien) are just "Today" with another name.
 */
export function toPeriods(rows) {
  return rows
    .map((r) => ({ start: r.startDate, end: r.endDate, name: (r.name.find((n) => n.language === "DE") ?? r.name[0]).text }))
    .filter((p) => /ferien$/i.test(p.name) && (Date.parse(p.end) - Date.parse(p.start)) / DAY >= 2)
    .sort((a, b) => a.start.localeCompare(b.start));
}

async function main() {
  const year = new Date().getFullYear();
  const states = {};
  for (const s of STATES) {
    const url = `https://openholidaysapi.org/SchoolHolidays?countryIsoCode=DE&languageIsoCode=DE&validFrom=${year}-01-01&validTo=${year + 2}-12-31&subdivisionCode=DE-${s}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${s}: HTTP ${res.status}`);
    states[s] = toPeriods(await res.json());
    console.log(`${s}: ${states[s].length} holidays, last ends ${states[s].at(-1)?.end}`);
  }
  writeFileSync(OUT, JSON.stringify({ source: "https://openholidaysapi.org", states }, null, 1) + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
