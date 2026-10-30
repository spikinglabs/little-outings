// City alerts: rare things in a big city that parents should know before they go out (a big demo, an
// evacuation, a transit strike). Only alerts someone confirmed in the admin's "City alerts" panel are in
// data/alerts.json (see scripts/check-alerts.mjs and admin/lib/alerts.js). Each has our own short line per
// language and a link to the official source. Plain logic here; the file is read in lib/data.ts.
import type { Lang } from "./i18n";

export interface Alert {
  id: string;
  city: string;
  /** YYYY-MM-DD; `until` when it lasts several days. */
  day: string;
  until?: string;
  /** HH:MM */
  from?: string;
  to?: string;
  kind: string;
  /** demonstration, march, police_operation, closure, strike, evacuation, crowd_event, other */
  type?: string;
  /** People the organisers registered or the police expect. */
  expected?: number;
  where?: string;
  /** A march's streets in order (German names). */
  route?: string;
  /** Bus, tram and train lines named as affected. */
  lines?: string[];
  line: Record<Lang, string>;
  /** What it is about and who organises it, as the official page says. */
  about?: Record<Lang, string>;
  /** The concrete facts: closures, diversions, when it ends. */
  points?: Record<Lang, string[]>;
  url: string;
}

export const AHEAD = 7; // days: alerts further out are not shown yet

const plusDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Alerts still on or coming within AHEAD days of `today`, soonest first. */
export function current(alerts: Alert[], today: string): Alert[] {
  const last = plusDays(today, AHEAD);
  return alerts.filter((a) => (a.until || a.day) >= today && a.day <= last)
    .sort((a, b) => a.day.localeCompare(b.day) || (a.from || "").localeCompare(b.from || ""));
}

/** "Sa., 31. Okt., 14:00–18:00" in the reader's language; days only when it lasts several. */
export function whenText(a: Alert, locale: string): string {
  const day = (d: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${d}T12:00:00Z`));
  const days = a.until ? `${day(a.day)} – ${day(a.until)}` : day(a.day);
  const time = a.from ? (a.to ? `${a.from}–${a.to}` : a.from) : "";
  return [days, time].filter(Boolean).join(", ");
}
