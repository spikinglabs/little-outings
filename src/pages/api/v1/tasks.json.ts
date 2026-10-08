// Open questions (gaps), most useful first. One entry per item, with all of its gaps.
import type { APIRoute } from "astro";
import { getTasks, TODAY } from "../../../lib/data";

export const GET: APIRoute = async () => {
  const tasks = (await getTasks()).map(({ score, ...task }) => task);
  return new Response(JSON.stringify({ version: 1, generated: TODAY, tasks }, null, 1), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
