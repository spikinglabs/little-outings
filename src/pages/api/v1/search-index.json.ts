// The compact index /api/v1/search and the /mcp connector search (src/lib/search.ts).
import type { APIRoute } from "astro";
import { getData, TODAY } from "../../../lib/data";
import { entryOf, type Index } from "../../../lib/search";

export const GET: APIRoute = async () => {
  const { events, places, region } = await getData();
  const towns = region.towns.map(({ name, lat, lon, en, zh }) => ({ name, lat, lon, ...(en ? { en } : {}), ...(zh ? { zh } : {}) }));
  const index: Index = { generated: TODAY, today: TODAY, towns, items: [...events, ...places].map(entryOf) };
  return new Response(JSON.stringify(index), { headers: { "content-type": "application/json; charset=utf-8" } });
};
