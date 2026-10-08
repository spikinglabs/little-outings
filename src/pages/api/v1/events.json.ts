// Static JSON for the future spikinglabs app and other tools. Same records the pages use.
import type { APIRoute } from "astro";
import { getData, TODAY } from "../../../lib/data";

export const GET: APIRoute = async () => {
  const { events } = await getData();
  return new Response(JSON.stringify({ version: 1, generated: TODAY, events }, null, 1), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
