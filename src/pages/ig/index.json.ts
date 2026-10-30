// What the admin's Instagram box shows (admin/public/instagram.js, through admin/functions/api/instagram.js):
// each set's caption, ready to copy, and its pictures in order.
import type { APIRoute } from "astro";
import { igPicturesOf, instagramSets } from "../../lib/instagram-data";

export const GET: APIRoute = async () => {
  const sets = (await instagramSets()).map(({ sheets, ...s }) => ({ ...s, pictures: igPicturesOf({ ...s, sheets }) }));
  return new Response(JSON.stringify({ sets }, null, 1), { headers: { "content-type": "application/json" } });
};
