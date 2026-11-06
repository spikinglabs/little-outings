import { cardsHandler } from "../../lib/cards.js";
import { applyApproval, tokenFile, tokenInfo } from "../../lib/instagram.js";
import { KEYS, json, readJson } from "../../lib/store.js";

// Instagram sets: the cards and captions the site's build drew (/ig/index.json, src/lib/instagram.ts),
// with each set's Approve and posting state. PUT approves a set, takes an approval back, or saves the
// account's access token. Nothing posts from here: scripts/post-instagram.mjs posts approved sets.
const cards = cardsHandler({ dir: "ig", ext: "jpg", type: "image/jpeg", label: "Instagram" });

async function state(env) {
  const [approvals, posted, token] = await Promise.all([KEYS.igApprovals, KEYS.igPosted, KEYS.igToken].map((k) => readJson(env.OUTINGS, k)));
  return { approvals: approvals ?? {}, posted: posted ?? {}, token: tokenInfo(token) };
}

export async function onRequestGet(context) {
  const res = await cards(context);
  if (new URL(context.request.url).searchParams.has("pic") || !res.ok || !context.env.OUTINGS) return res;
  return json({ ...(await res.json()), ...(await state(context.env)) });
}

export async function onRequestPut(context) {
  const { request, env, data } = context;
  if (!env.OUTINGS) return json({ error: "The OUTINGS bucket binding is missing." }, 500);
  if (Number(request.headers.get("content-length") || 0) > 5_000) return json({ error: "Too large." }, 413);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Expected JSON." }, 400); }
  const put = (key, value) => env.OUTINGS.put(key, JSON.stringify(value, null, 2), { httpMetadata: { contentType: "application/json" } });
  try {
    if (body.action === "token") {
      await put(KEYS.igToken, await tokenFile(body.token));
    } else {
      const list = await (await cards({ ...context, request: new Request(new URL("/api/instagram", request.url)) })).json();
      const approvals = await readJson(env.OUTINGS, KEYS.igApprovals);
      await put(KEYS.igApprovals, applyApproval(approvals, body, data.user, list.sets ?? []));
    }
  } catch (error) {
    return json({ error: error.message }, 400);
  }
  return json(await state(env));
}
