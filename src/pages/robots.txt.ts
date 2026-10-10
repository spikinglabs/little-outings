// Every crawler is welcome, AI answer engines included: the listings are public and families find them that way.
import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  const base = site?.toString().replace(/\/$/, "") ?? "";
  const body = ["User-agent: *", "Disallow: /admin/", "Disallow: /api/", "Allow: /api/v1/", "", `Sitemap: ${base}/sitemap.xml`, ""].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
