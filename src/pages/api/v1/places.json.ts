import type { APIRoute } from "astro";
import { getData, TODAY } from "../../../lib/data";

export const GET: APIRoute = async () => {
  const { places } = await getData();
  return new Response(JSON.stringify({ version: 1, generated: TODAY, places }, null, 1), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
