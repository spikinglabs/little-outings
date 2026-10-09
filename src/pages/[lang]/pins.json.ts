import type { APIRoute } from "astro";
import { LANGS, useT, type Lang } from "../../lib/i18n";
import { getData } from "../../lib/data";
import { buildPins } from "../../lib/pins";

// The Discover map's pins, fetched only when someone opens the map; inlined they made the page 1 MB heavier.
export const getStaticPaths = () => LANGS.map((lang) => ({ params: { lang } }));

export const GET: APIRoute = async ({ params }) => {
  const lang = params.lang as Lang;
  const pins = buildPins(await getData(), lang, useT(lang));
  return new Response(JSON.stringify(pins), { headers: { "content-type": "application/json; charset=utf-8" } });
};
