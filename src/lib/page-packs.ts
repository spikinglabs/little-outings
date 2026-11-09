// Event and place pages, packed: Cloudflare Pages takes at most 20,000 files per deploy, and every
// event and place used to be a page per language (places around 70 more cities would be ~30,000). After `astro build`, scripts/pack-pages.mjs moves each event page into
// one of a few hundred pack files (/packs/<section>/<lang>/<n>.jsonl); the Pages Functions in
// functions/<lang>/termine/ and functions/<lang>/orte/ serve a page from its pack, and /api/ics reads calendar files from there.
// The pages themselves are unchanged: still built by Astro, still at /<lang>/termine/<id>/ and /<lang>/orte/<id>/.
// Pure code with no Astro imports: it runs at build time and inside Cloudflare Pages Functions.
// Event addresses that no longer have a page get the "this event is over" page (src/lib/gone.ts).
import { fillGone, TEMPLATE_ID, UNKNOWN_ID, type GoneEntry } from "./gone.ts";

export type Assets = (path: string) => Promise<Response>;

/** The page sections that are packed instead of deployed as one file per page and language. */
export const PACKED = ["termine", "orte"] as const;
export type Section = (typeof PACKED)[number];

/** Packs per section and language. 256 keeps a pack around 200 KB at two weeks of events, and
 * places (~13,000 with the places-only towns) at ~50 per pack. */
export const PACKS = 256;

/** Which pack a page goes in, by a hash of its id (FNV-1a: the same in Node and in Workers). */
export function packOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h % PACKS;
}

export const packPath = (section: Section, lang: string, id: string) =>
  `/packs/${section}/${lang}/${packOf(id).toString(16).padStart(2, "0")}.jsonl`;

/** Packs per language for gone events (src/lib/gone.ts): a line is ~1 KB, so a few months of past events fit. */
export const GONE_PACKS = 64;
export const gonePath = (lang: string, id: string) =>
  `/packs/gone/${lang}/${(packOf(id) % GONE_PACKS).toString(16).padStart(2, "0")}.jsonl`;

/** One line of a pack: `["<id>","<html>"]`. JSON keeps each page on one line. */
export const packLine = (id: string, html: string) => JSON.stringify([id, html]);

/** The page with this id in a pack's text, or null. Only that page's line is parsed. */
export function pageIn(pack: string, id: string): string | null {
  const key = `${JSON.stringify([id]).slice(0, -1)},`;
  let at = 0;
  if (!pack.startsWith(key)) {
    at = pack.indexOf(`\n${key}`) + 1;
    if (at === 0) return null;
  }
  const end = pack.indexOf("\n", at);
  const [, html] = JSON.parse(pack.slice(at, end < 0 ? undefined : end)) as [string, string];
  return html;
}

/** Ids are the build's own (evt_…, community slugs); anything else can't be in a pack. */
export const validId = (id: string) => /^[\w-]{1,120}$/.test(id);

/** A packed page's HTML, or null when there is no such page. */
export async function readPacked(assets: Assets, section: Section, lang: string, id: string): Promise<string | null> {
  if (!validId(id)) return null;
  const res = await assets(packPath(section, lang, id));
  return res.ok ? pageIn(await res.text(), id) : null;
}

/**
 * GET /<lang>/<section>/<id>/ from its pack, for the Pages Functions in functions/<lang>/<section>/.
 * Without the trailing slash it redirects, as Pages does for a static page; an unknown id gets the
 * site's 404 page. The pages.dev copy stays out of search results, as public/_headers says for files.
 */
export async function servePacked(request: Request, assets: Assets, section: Section): Promise<Response> {
  const url = new URL(request.url);
  const [, lang, , id = "", ...rest] = url.pathname.split("/");
  if (id && !rest.length) return Response.redirect(new URL(`${url.pathname}/${url.search}`, url).toString(), 308);
  const page = rest.length === 1 && rest[0] === "";
  const html = page && id !== TEMPLATE_ID ? await readPacked(assets, section, lang, id) : null;
  const res = html !== null
    ? new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })
    : (page && section === "termine" && await serveGone(assets, lang, id, url)) || await notFound(assets);
  res.headers.set("cache-control", "public, max-age=0, must-revalidate");
  if (url.hostname.endsWith(".pages.dev")) res.headers.set("x-robots-tag", "noindex");
  return res;
}

/**
 * An event address with no page: the next date of the same event, or the "this event is over" page.
 * An address nothing is known about gets that page too, saying only that the event is no longer
 * listed, with status 404. Null when the build has no gone pages (an older deploy, a language without them).
 */
async function serveGone(assets: Assets, lang: string, id: string, url: URL): Promise<Response | null> {
  if (!validId(id)) return null;
  const read = async (key: string): Promise<GoneEntry | null> => {
    const res = await assets(gonePath(lang, key));
    const line = res.ok ? pageIn(await res.text(), key) : null;
    return line === null ? null : JSON.parse(line);
  };
  const known = await read(id);
  if (known?.to) return new Response(null, { status: 302, headers: { location: new URL(known.to, url).toString() } });
  const entry = known ?? await read(UNKNOWN_ID);
  const template = entry && await readPacked(assets, "termine", lang, TEMPLATE_ID);
  if (!entry || !template) return null;
  return new Response(fillGone(template, id, entry), {
    status: known ? 200 : 404,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function notFound(assets: Assets): Promise<Response> {
  // Pages answers a missing file with dist/404.html; asking for "/404" gets it either way.
  const text = await (await assets("/404")).text();
  return new Response(text.includes("<html") ? text : "Not found", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
}
