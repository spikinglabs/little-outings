// Calendar feeds organisers send from the Add page ("Send us your calendar"): an iCal (.ics) link
// that Google Calendar or Outlook could subscribe to. functions/api/feed.ts opens the link and this
// says what is in it, so the organiser sees at once whether it works, and the moderator sees the same
// in the inbox. cityklub-event-data's `ical` adapter collects an approved feed every night.
// Pure code with no Astro imports: it runs in the browser, in Pages Functions and in tests.

export interface FeedCheck {
  /** Events in the file, and how many start today or later. */
  events: number;
  upcoming: number;
  /** The next few upcoming events, soonest first. */
  next: { title: string; date: string }[];
}

/** An https URL for what the organiser pasted (webcal:// is the same feed over https), or null. */
export function feedUrl(input: unknown): string | null {
  const raw = String(input ?? "").trim().replace(/^webcals?:\/\//i, "https://");
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || raw.length > 1000) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Lines of an iCal file with folded continuation lines joined (RFC 5545 §3.1). */
const unfold = (text: string) => text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");

const unescape = (value: string) =>
  value.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").replace(/\s+/g, " ").trim();

/** "YYYY-MM-DD" from a DTSTART value such as 20261102, 20261102T150000 or 20261102T140000Z. */
const dayOf = (value: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
};

/** What an iCal file holds, or null when it isn't one. `today` is "YYYY-MM-DD". */
export function checkIcs(text: string, today: string): FeedCheck | null {
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) return null;
  const found: { title: string; date: string }[] = [];
  let event: { title: string; date: string } | null = null;
  for (const line of unfold(text)) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VEVENT")) event = { title: "", date: "" };
    else if (upper.startsWith("END:VEVENT")) {
      if (event) found.push(event);
      event = null;
    } else if (event) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const name = upper.slice(0, colon).split(";")[0];
      if (name === "SUMMARY") event.title = unescape(line.slice(colon + 1)).slice(0, 120);
      else if (name === "DTSTART") event.date = dayOf(line.slice(colon + 1));
    }
  }
  const upcoming = found.filter((e) => e.date && e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  return { events: found.length, upcoming: upcoming.length, next: upcoming.slice(0, 3) };
}

/** One line for the moderator: "42 upcoming of 50 events; next: 2026-11-02 Kasperltheater". */
export function checkSummary(check: FeedCheck | null): string {
  if (!check) return "not a calendar file";
  const next = check.next[0];
  return `${check.upcoming} upcoming of ${check.events} events${next ? `; next: ${next.date} ${next.title}` : ""}`;
}
