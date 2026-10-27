import type { APIRoute } from "astro";
import type { Pin } from "../../../islands/OutingsMap";
import { LANGS, useT } from "../../../lib/i18n";
import { getData } from "../../../lib/data";
import { buildPins } from "../../../lib/pins";
import { tileOf } from "../../../lib/tiles";

// The Discover map's pins, one file per tile (lib/tiles.ts): the map fetches those of the tiles the list
// has loaded, the "Where?" picker those around home. All in one file they would be ~4 MB.
export async function getStaticPaths() {
  const data = await getData();
  return LANGS.flatMap((lang) => {
    const tiles = new Map<string, Pin[]>();
    for (const p of buildPins(data, lang, useT(lang))) {
      const k = tileOf(p.lat, p.lon);
      (tiles.get(k) ?? tiles.set(k, []).get(k)!).push(p);
    }
    return [...tiles].map(([tile, pins]) => ({ params: { lang, tile }, props: { pins } }));
  });
}

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify(props.pins), { headers: { "content-type": "application/json; charset=utf-8" } });
