// Pages for events that are gone: over, or no longer listed. A search engine keeps an event's
// address long after the event, and people kept arriving from Google at a 404 (Karnevalsrakete,
// 7 Nov 2026). Now the address answers with what the event was, that it is over, and what is on
// soon in the same town, or sends the reader on to the next date of the same event.
//
// The build writes one entry per gone event and language (src/pages/gone/[lang].jsonl.ts), packed
// like the event pages (scripts/pack-pages.mjs); functions/<lang>/termine/ fills them into the page
// /<lang>/termine/vorbei/ (src/lib/page-packs.ts). Pure code: no Astro imports, tested in tests/gone.test.ts.
import type { Event } from "./types.ts";

/** The template page's id under /<lang>/termine/; never an event id (those are ck-…, community slugs, fixture ids). */
export const TEMPLATE_ID = "vorbei";
/** The entry an address gets when nothing is known about it. */
export const UNKNOWN_ID = "-";
/** A gone page stays in search results this many days after the event, then asks to be dropped. */
export const INDEX_DAYS = 30;
/** Upcoming events a gone page suggests. */
export const RELATED = 4;

/** What the Function needs for one gone address. */
export interface GoneEntry {
  /** Send the reader here instead (the next date of the same event). */
  to?: string;
  title?: string;
  description?: string;
  /** The page's main part, HTML. */
  body?: string;
  noindex?: boolean;
}

const plain = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const germanTitle = (e: Pick<Event, "title">) => (typeof e.title === "string" ? e.title : e.title.de);
/** Same event, another date or another id: same title, town and venue. */
export const sameKey = (e: Pick<Event, "title" | "town" | "venue">) => `${plain(germanTitle(e))}|${e.town ?? ""}|${plain(e.venue ?? "")}`;

/** The next date of the same event among the upcoming ones, if any. */
export function nextOf(gone: Event, upcoming: Event[]): Event | undefined {
  const key = sameKey(gone);
  return upcoming.filter((e) => e.id !== gone.id && e.start >= gone.start && sameKey(e) === key)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
}

/** Upcoming events in the gone event's town, the most alike first: same season, same venue, shared tags. */
export function relatedTo(gone: Event, upcoming: Event[], n = RELATED): Event[] {
  const venue = plain(gone.venue ?? "");
  const score = (e: Event) =>
    3 * (e.seasons ?? []).filter((s) => gone.seasons?.includes(s)).length
    + (venue && plain(e.venue ?? "") === venue ? 2 : 0)
    + e.tags.filter((g) => g !== "other" && gone.tags.includes(g)).length;
  return upcoming.filter((e) => e.town === gone.town && e.id !== gone.id)
    .map((e) => ({ e, s: score(e) }))
    .sort((a, b) => b.s - a.s || a.e.start.localeCompare(b.e.start) || a.e.id.localeCompare(b.e.id))
    .slice(0, n).map((x) => x.e);
}

/** Whether search engines should still list a gone event's page on `today`. */
export function stillIndexed(gone: Pick<Event, "end">, today: string): boolean {
  const days = (Date.parse(today) - Date.parse(gone.end)) / 864e5;
  return days <= INDEX_DAYS;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

/** The template's placeholders, filled by fillGone(). */
export const SLOT = { title: "__GONE_TITLE__", description: "__GONE_DESC__", body: "__GONE_BODY__" } as const;

/**
 * The template page with one entry filled in, at the address of `id`. Text in the entry is already
 * HTML-safe for the body; title and description are escaped here.
 */
export function fillGone(template: string, id: string, entry: GoneEntry): string {
  let html = template
    .replaceAll(`/termine/${TEMPLATE_ID}/`, `/termine/${id}/`)
    .replaceAll(SLOT.title, esc(entry.title ?? ""))
    .replaceAll(SLOT.description, esc(entry.description ?? ""))
    .replace(SLOT.body, () => entry.body ?? "");
  if (entry.noindex) {
    // Drop the address from search results; links from it still count.
    html = html.replace(/<link rel="canonical"[^>]*>/, "").replace("</head>", '<meta name="robots" content="noindex, follow"></head>');
  }
  return html;
}
