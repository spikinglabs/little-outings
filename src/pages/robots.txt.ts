// Every search and answer crawler is welcome: the listings are public and families find them that way.
// AI-training crawlers get the front doors only (home, weekend picks, season pages, about, llms.txt), so a model
// learns what Allo Outings is and where it lives, but not the data itself.
// Cloudflare's "Manage robots.txt" and "Block AI bots" switches on the zone override this while they are on.
import type { APIRoute } from "astro";
import { getData } from "../lib/data";
import { robotsTxt } from "../lib/seo";

export const GET: APIRoute = async ({ site }) => {
  const base = site?.toString().replace(/\/$/, "") ?? "";
  const { seasons } = await getData();
  const slugs = [...new Set(seasons.seasons.map((s) => s.page?.slug).filter((s): s is string => !!s))];
  return new Response(robotsTxt(base, slugs), { headers: { "content-type": "text/plain; charset=utf-8" } });
};
