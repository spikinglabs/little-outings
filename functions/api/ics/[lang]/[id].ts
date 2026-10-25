// Cloudflare Pages Function: GET /api/ics/<lang>/<id>.ics
// An event as a calendar file, for "Add to calendar" (Apple, Outlook, phones). The event page carries
// the file's text (built with the page, in its language); this reads it from the page's pack, so the
// build doesn't write a second file per event and language (Pages takes at most 20,000 files).
import { readPacked } from "../../../../src/lib/page-packs.ts";

interface Env { ASSETS: { fetch: (r: Request | string) => Promise<Response> } }
type Ctx = { request: Request; env: Env; params: { lang: string; id: string } };

const LANGS = ["de", "en", "zh"];

/** The calendar text an event page carries, or null. */
export function icsOf(html: string): string | null {
  const m = html.match(/<script type="text\/calendar" id="ics">([\s\S]*?)<\/script>/);
  return m ? m[1].replace(/<\\\//g, "</") : null;
}

export async function onRequestGet({ request, env, params }: Ctx) {
  const id = String(params.id).replace(/\.ics$/, "");
  if (!LANGS.includes(params.lang) || !/^[\w-]+$/.test(id)) return new Response("Not found", { status: 404 });
  const page = await readPacked((path) => env.ASSETS.fetch(new URL(path, request.url).toString()), "termine", params.lang, id);
  const text = page ? icsOf(page) : null;
  if (!text) return new Response("Not found", { status: 404 });
  return new Response(text, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${id}.ics"`,
      "cache-control": "public, max-age=3600",
    },
  });
}
