import { KEYS, json } from "../../lib/store.js";

// Rednote topic posts (posts/ in the site repository, drawn and uploaded by .github/workflows/posts.yml):
// little-outings/posts/<code>/post.json plus its pictures and video. GET lists every post, newest first;
// ?pic=<code>/<file>.png (or .mp4) passes one picture or the video through, so the Posts panel's buttons can
// hand the phone real files.
const PICTURE = /^[A-HJKMNP-Z2-9]{4}\/[a-z0-9-]+\.(png|mp4)$/;

export async function onRequestGet({ env, request }) {
  if (!env.OUTINGS) return json({ error: "The OUTINGS bucket binding is missing." }, 500);
  const pic = new URL(request.url).searchParams.get("pic");
  if (pic !== null) {
    if (!PICTURE.test(pic)) return json({ error: "Not a post picture." }, 400);
    // Phones play a video only from a server that answers byte ranges (Safari asks for bytes 0-1 first).
    const range = pic.endsWith(".mp4") && request.headers.get("range") ? { range: request.headers } : {};
    const object = await env.OUTINGS.get(`${KEYS.posts}${pic}`, range);
    if (!object) return json({ error: `No picture ${pic}.` }, 404);
    const type = pic.endsWith(".mp4") ? "video/mp4" : "image/png";
    const headers = { "content-type": type, "accept-ranges": "bytes" };
    const r = range.range && object.range;
    if (r && (r.offset !== undefined || r.suffix !== undefined)) {
      const start = r.suffix !== undefined ? object.size - r.suffix : r.offset;
      const end = r.suffix !== undefined ? object.size - 1 : r.length !== undefined ? start + r.length - 1 : object.size - 1;
      return new Response(object.body, { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${object.size}`, "content-length": String(end - start + 1) } });
    }
    return new Response(object.body, { headers: object.size !== undefined ? { ...headers, "content-length": String(object.size) } : headers });
  }
  const keys = [];
  let cursor;
  do {
    const page = await env.OUTINGS.list({ prefix: KEYS.posts, cursor });
    keys.push(...page.objects.map((o) => o.key).filter((k) => k.endsWith("/post.json")));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const posts = (await Promise.all(keys.map(async (key) => {
    const object = await env.OUTINGS.get(key);
    return object ? object.json().catch(() => null) : null;
  }))).filter(Boolean);
  posts.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  // The panel's card box joins site + picture path: here the path is <code>/<file> and "site" the pass-through.
  const sets = posts.map((p) => ({ ...p, kind: "post", pictures: p.pictures.map((f) => `${p.code}/${f}`), ...(p.video ? { video: `${p.code}/${p.video}` } : {}) }));
  return json({ site: "/api/posts?pic=", sets });
}
