// What the admin's Rednote box shows (admin/public/rednote.js, through admin/functions/api/rednote.js):
// each set's title and caption, ready to copy, and its pictures in order.
import type { APIRoute } from "astro";
import { rednoteSets, sheetFile } from "../../lib/rednote-data";

export const GET: APIRoute = async () => {
  const { sets } = await rednoteSets();
  const body = sets.map(({ sheets, ...s }) => ({ ...s, pictures: sheets.map((_, i) => `/xhs/${sheetFile(s.id, i)}.png`) }));
  return new Response(JSON.stringify({ sets: body }, null, 1), { headers: { "content-type": "application/json" } });
};
