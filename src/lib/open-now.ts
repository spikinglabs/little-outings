// "Open today until 21:00" for Christmas markets and other fixtures whose `time` is a German opening-hours line
// such as "So–Mi 11–21, Do–Fr 11–22, Sa 10–22 Uhr; Totensonntag (22.11.) zu; 24.12. 11–14 Uhr".
// Plain logic, no files: the season pages and the weekend page use it at build time (the site is built every night).

const WD = ["so", "mo", "di", "mi", "do", "fr", "sa"]; // getUTCDay() order
const dayOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const dm = (d: string) => `${+d.slice(8, 10)}.${+d.slice(5, 7)}.`; // 2026-11-22 → "22.11."

/** The weekdays a "Mo–Fr", "Sa", "Mo und Di" or "täglich" phrase covers, as getUTCDay() numbers. */
function weekdays(phrase: string): number[] | undefined {
  const p = phrase.toLowerCase();
  if (/täglich/.test(p)) return [0, 1, 2, 3, 4, 5, 6];
  const out = new Set<number>();
  for (const m of p.matchAll(/\b(mo|di|mi|do|fr|sa|so)\b(?:\s*[–-]\s*\b(mo|di|mi|do|fr|sa|so)\b)?/g)) {
    const a = WD.indexOf(m[1]), b = m[2] ? WD.indexOf(m[2]) : a;
    for (let i = a; ; i = (i + 1) % 7) { out.add(i); if (i === b) break; }
  }
  return out.size ? [...out] : undefined;
}

/** Dates a part names, as "22.11.", expanding "22. und 25.12." and "21.–23.12.". */
function dates(part: string): string[] {
  const p = part.replace(/(?<![\d.])(\d{1,2})\.\s*und\s*(\d{1,2})\.(\d{1,2})\./g, "$1.$3. und $2.$3.");
  const out: string[] = [];
  for (const m of p.matchAll(/(?<![\d.])(\d{1,2})\.\s*[–-]\s*(\d{1,2})\.(\d{1,2})\./g))
    for (let d = +m[1]; d <= +m[2]; d++) out.push(`${d}.${+m[3]}.`);
  for (const m of p.matchAll(/(?<![\d.–-])(\d{1,2})\.(\d{1,2})\.(?!\d)/g)) out.push(`${+m[1]}.${+m[2]}.`);
  return out;
}

/**
 * The opening hours on one day, "11–21", from a German hours line: a date's own entry first, then the
 * weekday's. "closed" when the line says that day is closed; undefined when the line doesn't say.
 */
export function hoursOn(time: string | undefined, day: string): string | "closed" | undefined {
  if (!time) return undefined;
  const parts = time.split(/;\s*|,\s*(?=\d{1,2}\.\d{1,2}\.)/).map((s) => s.trim()).filter(Boolean);
  // Date-specific entries win: "24.12. 11–14 Uhr", "Totensonntag (22.11.) zu", "22. und 25.12. zu".
  for (const part of parts) {
    if (!dates(part).includes(dm(day))) continue;
    if (/\b(zu|geschlossen)\b/i.test(part)) return "closed";
    const r = part.match(/(\d{1,2}(?::\d{2})?)\s*(?:–|-|bis)\s*(\d{1,2}(?::\d{2})?)\s*(?:Uhr)?\s*$/);
    if (r) return `${r[1]}–${r[2]}`;
  }
  const wd = dayOf(day);
  for (const part of parts) {
    if (dates(part).length || /\b(ab|nur)\b/i.test(part)) continue;
    // Closed weekdays: "Mo und Di zu".
    if (/\b(zu|geschlossen)\b/i.test(part)) { if (weekdays(part)?.includes(wd)) return "closed"; continue; }
    // "So–Mi 11–21, Do–Fr 11–22, Sa 10–22 Uhr" or "Täglich 11–21, Fr–Sa 11–22 Uhr": the last matching group wins,
    // so "Fr–Sa" overrides "Täglich".
    let found: string | undefined;
    for (const g of part.split(/,\s*/)) {
      const r = g.match(/^(.*?)(\d{1,2}(?::\d{2})?)\s*(?:–|-|bis)\s*(\d{1,2}(?::\d{2})?)/);
      if (!r) continue;
      const days = r[1].trim() ? weekdays(r[1]) : [0, 1, 2, 3, 4, 5, 6];
      if (days?.includes(wd)) found = `${r[2]}–${r[3]}`;
    }
    if (found) return found;
  }
  return undefined;
}

/** Whether an event is on that day: inside its dates and not closed by its hours line. */
export const runsOn = (e: { start: string; end: string; time?: string }, day: string) =>
  e.start <= day && day <= e.end && hoursOn(e.time, day) !== "closed";

/** Closing time of an "11–21" range as "21:00". */
export const until = (range: string) => { const t = range.split("–")[1]; return t.includes(":") ? t : `${t}:00`; };
