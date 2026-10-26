// Cloudflare Pages Function: GET /api/feed?url=<calendar link>
// Opens a calendar feed an organiser pasted on the Add page and says what is in it, before they send
// it (see src/lib/feed.ts). Read only: nothing is stored. POST /api/inbox {kind: "feed"} sends it.
//   200 { ok: true, events, upcoming, next: [{ title, date }] }
//   200 { ok: false, reason: "badUrl" | "unreachable" | "tooBig" | "notCalendar" }
import { checkIcs, feedUrl, type FeedCheck } from "../../src/lib/feed.ts";

const MAX_BYTES = 5_000_000;
const TIMEOUT_MS = 8000;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": "no-store" } });

export type FeedResult = ({ ok: true } & FeedCheck) | { ok: false; reason: "badUrl" | "unreachable" | "tooBig" | "notCalendar" };

/** Fetches and checks one feed. `fetchFn` is replaced in tests. */
export async function checkFeed(input: unknown, today: string, fetchFn: typeof fetch = fetch): Promise<FeedResult> {
  const url = feedUrl(input);
  if (!url) return { ok: false, reason: "badUrl" };
  let text: string;
  try {
    const res = await fetchFn(url, {
      headers: { accept: "text/calendar, */*;q=0.5", "user-agent": "little-outings feed check (+https://outings.allo.land)" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: "unreachable" };
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return { ok: false, reason: "tooBig" };
    text = await res.text();
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (text.length > MAX_BYTES) return { ok: false, reason: "tooBig" };
  const check = checkIcs(text, today);
  return check ? { ok: true, ...check } : { ok: false, reason: "notCalendar" };
}

export const berlinToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());

export async function onRequestGet({ request }: { request: Request }) {
  return json(await checkFeed(new URL(request.url).searchParams.get("url"), berlinToday()));
}
