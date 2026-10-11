// A plain-text guide for AI assistants (llmstxt.org): what the site is and where the data lives.
import type { APIRoute } from "astro";
import { getData } from "../lib/data";
import { useT } from "../lib/i18n";
import { townName } from "../lib/format";

export const GET: APIRoute = async ({ site }) => {
  const base = site?.toString().replace(/\/$/, "") ?? "";
  const { events, places, region } = await getData();
  const t = useT("en");
  const towns = region.towns.map((x) => townName(x.name, "en", region.towns)).join(", ");
  const kinds = [...new Set(places.map((p) => p.kind))].map((k) => t(`kinds.${k}`).toLowerCase()).join(", ");
  const body = `# Little Outings

> Family outings around ${townName(region.center, "en", region.towns)}, Germany: events for kids and kid-friendly places (${kinds}), in German, English and Chinese (小出游). Free to use, no sign-up. A product by Spiking Labs.

Listings cover ${events.length} upcoming family events and ${places.length} places in and around ${towns}. Every page exists in German (/de/), English (/en/) and Simplified Chinese (/zh/). Pages are rebuilt every night, so past events drop off.

Events come from public city calendars (via cityklub) and from parents; places come from OpenStreetMap (© OpenStreetMap contributors, ODbL) and from parents. Facilities such as changing tables, high chairs or a sandpit are marked only when someone has confirmed them; "unknown" means nobody has told us yet. Please check with the organiser before you go.

## Pages

- [Discover, English](${base}/en/): this weekend's events and nearby places, with a map
- [Entdecken, Deutsch](${base}/de/)
- [发现, 中文](${base}/zh/)
- [Data sources and privacy](${base}/en/daten/)
- [Add an event or place](${base}/en/mitmachen/)
- Event pages: ${base}/{de|en|zh}/termine/{id}/ (also an .ics calendar file at ${base}/{lang}/termine/{id}.ics)
- Place pages: ${base}/{de|en|zh}/orte/{id}/

## For AI assistants

- MCP connector (Streamable HTTP, no login): ${base}/mcp. Tools: search, fetch, and suggest_event, suggest_place, add_tip, report_problem (these go to a moderator for review before anything is published).
- [Search](${base}/api/v1/search?town=Köln&what=events&lang=en): GET /api/v1/search with q (free text), town, lat, lon, radius_km, from, to (YYYY-MM-DD; default the next 7 days), what (events | places | all), kinds, indoor, free, needs (confirmed facilities), lang (de | en | zh), limit (≤ 50). Returns short results with page links.

## Data (JSON, same records as the pages)

- [Events](${base}/api/v1/events.json): title (de, plus zh/en translations), start and end date, time, town, venue, location precision, price, tags, source
- [Places](${base}/api/v1/places.json): name, kind, address, coordinates, opening hours, confirmed facilities, parents' tips
- [Sitemap](${base}/sitemap.xml)
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
