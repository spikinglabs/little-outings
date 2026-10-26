// What the admin's Rednote box shows (admin/public/rednote.js, through admin/functions/api/rednote.js):
// each set's title and caption, ready to copy, and its pictures in order.
import type { APIRoute } from "astro";
import { picturesOf, rednoteSets } from "../../lib/rednote-data";

export const GET: APIRoute = async () => {
  const { sets } = await rednoteSets();
  const body = sets.map(({ sheets, ...s }) => ({ ...s, pictures: picturesOf({ ...s, sheets }) }));
  return new Response(JSON.stringify({ sets: body }, null, 1), { headers: { "content-type": "application/json" } });
};
