// /de/termine/<id>.ics: the event as a calendar file, for "Add to calendar" (Apple, Outlook, phones).
import type { APIRoute } from "astro";
import { LANGS, type Lang } from "../../../lib/i18n";
import { getData } from "../../../lib/data";
import { calInput } from "../../../lib/event-cal";
import { ics } from "../../../lib/calendar";
import type { Event } from "../../../lib/types";

export async function getStaticPaths() {
  const { events } = await getData();
  return LANGS.flatMap((lang) => events.map((e) => ({ params: { lang, id: e.id }, props: { event: e } })));
}

export const GET: APIRoute = async ({ params, props, site }) => {
  const input = await calInput(props.event as Event, params.lang as Lang, site);
  // The build day, not the second: unchanged events give the same file, so a deploy skips uploading it.
  const stamp = `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}T000000Z`;
  return new Response(ics(input, stamp), { headers: { "content-type": "text/calendar; charset=utf-8" } });
};
