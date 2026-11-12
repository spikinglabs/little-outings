import { KEYS, json } from "../../lib/store.js";

// Rednote topic posts (posts/ in the site repository, drawn and uploaded by .github/workflows/posts.yml):
// little-outings/posts/<code>/post.json plus its pictures. GET lists every post, newest first; ?pic=<code>/<file>.png
// passes one picture through, so the Posts panel's "Post" button can hand the phone real files.
const PICTURE = /^[A-HJKMNP-Z2-9]{4}\/[a-z0-9-]+\.png$/;

export async function onRequestGet({ env, request }) {
  if (!env.OUTINGS) return json({ error: "The OUTINGS bucket binding is missing." }, 500);
  const pic = new URL(request.url).searchParams.get("pic");
  if (pic !== null) {
    if (!PICTURE.test(pic)) return json({ error: "Not a post picture." }, 400);
    const object = await env.OUTINGS.get(`${KEYS.posts}${pic}`);
    if (!object) return json({ error: `No picture ${pic}.` }, 404);
    return new Response(object.body, { headers: { "content-type": "image/png" } });
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
  const sets = posts.map((p) => ({ ...p, kind: "post", pictures: p.pictures.map((f) => `${p.code}/${f}`) }));
  return json({ site: "/api/posts?pic=", sets });
}
