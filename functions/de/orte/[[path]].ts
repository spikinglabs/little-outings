// Cloudflare Pages Function: GET /de/orte/<id>/, a place page, served from its pack (src/lib/page-packs.ts).
import { servePacked } from "../../../src/lib/page-packs.ts";

interface Env { ASSETS: { fetch: (r: Request | string) => Promise<Response> } }

export const onRequestGet = ({ request, env }: { request: Request; env: Env }) =>
  servePacked(request, (path) => env.ASSETS.fetch(new URL(path, request.url).toString()), "orte");
export const onRequestHead = onRequestGet;
