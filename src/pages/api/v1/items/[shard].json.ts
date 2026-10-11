// Full event and place records, split by a hash of the id so the /mcp connector reads one small file per item.
import type { APIRoute } from "astro";
import { getData, TODAY } from "../../../../lib/data";
import { SHARDS, shardOf } from "../../../../lib/search";

export const getStaticPaths = () => Array.from({ length: SHARDS }, (_, i) => ({ params: { shard: String(i) } }));

export const GET: APIRoute = async ({ params }) => {
  const { events, places } = await getData();
  const items = [...events, ...places].filter((x) => shardOf(x.id) === Number(params.shard));
  return new Response(JSON.stringify({ version: 1, generated: TODAY, items }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
