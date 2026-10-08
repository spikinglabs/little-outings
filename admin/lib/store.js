// Reads and writes the Little Outings bucket (R2 binding OUTINGS).
// cityklub writes candidates; only this admin writes decisions.

import { emptyDecisions, parseJsonl } from "../public/apply.js";

export const PREFIX = "little-outings";
export const KEYS = {
  candidates: `${PREFIX}/candidates.jsonl`,
  manifest: `${PREFIX}/candidates.json`,
  decisions: `${PREFIX}/decisions.json`,
  lastPublish: `${PREFIX}/last-publish.json`,
};

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function readCandidates(bucket) {
  const [rows, manifest] = await Promise.all([bucket.get(KEYS.candidates), bucket.get(KEYS.manifest)]);
  return {
    rows: rows ? parseJsonl(await rows.text()) : [],
    manifest: manifest ? await manifest.json() : null,
  };
}

/** Decisions plus the ETag a later write must match. */
export async function readDecisions(bucket) {
  const object = await bucket.get(KEYS.decisions);
  if (!object) return { decisions: emptyDecisions(), etag: null };
  return { decisions: await object.json(), etag: object.etag };
}

export async function readJson(bucket, key) {
  const object = await bucket.get(key);
  return object ? object.json() : null;
}
