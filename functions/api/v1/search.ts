// Cloudflare Pages Function: GET /api/v1/search
// Finds events and places for AI assistants and other tools; the /mcp connector runs the same search.
//
//   /api/v1/search?town=Köln&from=2026-10-17&to=2026-10-18&what=events&kinds=stage,music&indoor=true&lang=en
//   /api/v1/search?q=playground+sandpit+cologne
//
// Parameters (all optional): q, town, lat, lon, radius_km (default 10), from, to (YYYY-MM-DD; default
// the next 7 days), what (events | places | all), kinds (comma list), indoor, free, needs (facilities,
// comma list), lang (de | en | zh, default en), limit (default 20, at most 50).
// It reads the static index the build writes (src/lib/search.ts), so it needs no bindings.
import { loadIndex, search, type Query } from "../../../src/lib/search.ts";

interface Env { ASSETS: { fetch: (r: Request | string) => Promise<Response> } }
type Ctx = { request: Request; env: Env };

const headers = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" };

export function queryOf(p: URLSearchParams): Query {
  const list = (k: string) => p.get(k)?.split(",").map((s) => s.trim()).filter(Boolean);
  const bool = (k: string) => (p.get(k) === "true" || p.get(k) === "1" ? true : p.get(k) === "false" || p.get(k) === "0" ? false : undefined);
  const num = (k: string) => (p.get(k) ? Number(p.get(k)) : undefined);
  return {
    q: p.get("q") ?? undefined, town: p.get("town") ?? undefined, lat: num("lat"), lon: num("lon"), radius_km: num("radius_km"),
    from: p.get("from") ?? undefined, to: p.get("to") ?? undefined, what: (p.get("what") ?? undefined) as Query["what"],
    kinds: list("kinds"), indoor: bool("indoor"), free: bool("free"), needs: list("needs"),
    lang: (p.get("lang") ?? undefined) as Query["lang"], limit: num("limit"),
  };
}

export async function onRequestGet({ request, env }: Ctx) {
  const url = new URL(request.url);
  const index = await loadIndex((path) => env.ASSETS.fetch(new URL(path, url.origin).toString()));
  const result = search(index, queryOf(url.searchParams), url.origin);
  return new Response(JSON.stringify(result), { headers: { ...headers, "cache-control": "public, max-age=300" } });
}
