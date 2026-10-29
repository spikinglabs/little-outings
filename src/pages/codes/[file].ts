// Page codes from the share cards (src/lib/rednote-code.ts), split by first character so the search box
// fetches one small file: /codes/7.json → { "7KQ3MX": "termine/<id>/", … }.
import type { APIRoute } from "astro";
import { pageCodes } from "../../lib/item-codes";

export async function getStaticPaths() {
  const groups = new Map<string, Record<string, string>>();
  for (const [path, code] of await pageCodes()) {
    const g = groups.get(code[0]) ?? {};
    g[code] = path;
    groups.set(code[0], g);
  }
  return [...groups].map(([first, codes]) => ({ params: { file: `${first}.json` }, props: { codes } }));
}

export const GET: APIRoute = ({ props }) => new Response(JSON.stringify(props.codes), { headers: { "content-type": "application/json" } });
