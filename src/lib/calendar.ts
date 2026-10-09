// "Add to calendar" for an event: a Google Calendar link and an .ics file (Apple, Outlook, most phones).
// Pure functions without Astro imports, so `node --test` can run them directly.

export interface CalInput {
  id: string;
  title: string;
  start: string; // YYYY-MM-DD
  end: string;
  time?: string; // "15:00", "10:00–11:00 Europe/Berlin", …
  location?: string;
  url: string;
}
/** All-day: [startDate, dayAfterEnd]. Timed: local Berlin times as YYYYMMDDTHHMMSS. */
export type When = { allDay: true; from: string; to: string } | { allDay: false; from: string; to: string };

const compact = (d: string) => d.replace(/-/g, "");
const nextDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, "0");

/** A single-day event with a start time gets times (two hours when no end is given); everything else is all-day. */
export function whenOf(e: Pick<CalInput, "start" | "end" | "time">): When {
  const m = /^(\d{1,2})[:.](\d{2})(?:\s*[–-]\s*(\d{1,2})[:.](\d{2}))?/.exec(e.time ?? "");
  if (e.start !== e.end || !m) return { allDay: true, from: compact(e.start), to: compact(nextDay(e.end)) };
  const sh = +m[1], sm = +m[2];
  let eh = m[3] ? +m[3] : sh + 2, em = m[3] ? +m[4] : sm;
  if (eh > 23 || eh * 60 + em <= sh * 60 + sm) { eh = 23; em = 59; }
  const day = compact(e.start);
  return { allDay: false, from: `${day}T${pad(sh)}${pad(sm)}00`, to: `${day}T${pad(eh)}${pad(em)}00` };
}

export function googleUrl(e: CalInput): string {
  const w = whenOf(e);
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${w.from}/${w.to}`, details: e.url });
  if (e.location) q.set("location", e.location);
  if (!w.allDay) q.set("ctz", "Europe/Berlin");
  return `https://calendar.google.com/calendar/render?${q}`;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** Lines longer than 75 octets are folded, as the iCalendar format asks. */
const fold = (line: string) => {
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > 74) { out.push(cur); cur = " "; }
    cur += ch;
  }
  return [...out, cur].join("\r\n");
};

const BERLIN = [
  "BEGIN:VTIMEZONE", "TZID:Europe/Berlin",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
  "END:VTIMEZONE",
];

export function ics(e: CalInput, stamp: string): string {
  const w = whenOf(e);
  const date = (k: string, v: string) => (w.allDay ? `${k};VALUE=DATE:${v}` : `${k};TZID=Europe/Berlin:${v}`);
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Little Outings//outings.allo.land//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    // Outlook needs the time zone spelled out; others accept it too.
    ...(w.allDay ? [] : BERLIN),
    "BEGIN:VEVENT",
    `UID:${e.id}@outings.allo.land`,
    `DTSTAMP:${stamp}`,
    date("DTSTART", w.from),
    date("DTEND", w.to),
    `SUMMARY:${esc(e.title)}`,
    ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
    `DESCRIPTION:${esc(e.url)}`,
    `URL:${e.url}`,
    "END:VEVENT", "END:VCALENDAR", "",
  ].map(fold).join("\r\n");
}
