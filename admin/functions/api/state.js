import { KEYS, json, readCandidates, readDecisions, readJson } from "../../lib/store.js";

export async function onRequestGet({ env, data }) {
  if (!env.OUTINGS) return json({ error: "The OUTINGS bucket binding is missing." }, 500);
  const [{ rows, manifest }, { decisions, etag }, lastPublish] = await Promise.all([
    readCandidates(env.OUTINGS),
    readDecisions(env.OUTINGS),
    readJson(env.OUTINGS, KEYS.lastPublish),
  ]);
  return json({ user: data.user, candidates: rows, manifest, decisions, etag, lastPublish });
}
