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
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  return new Response(ics(input, stamp), { headers: { "content-type": "text/calendar; charset=utf-8" } });
};
