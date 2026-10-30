// Reads and writes the Allo Outings bucket (R2 binding OUTINGS).
// cityklub writes candidates; only this admin writes decisions; the nightly sort writes verdicts.

import { emptyDecisions, parseJsonl } from "../public/apply.js";

export const PREFIX = "little-outings";
export const KEYS = {
  candidates: `${PREFIX}/candidates.jsonl`,
  manifest: `${PREFIX}/candidates.json`,
  decisions: `${PREFIX}/decisions.json`,
  lastPublish: `${PREFIX}/last-publish.json`,
  // The nightly AI sorting's verdicts, written by scripts/sort-events.mjs in the site repository.
  sorted: `${PREFIX}/sorted.json`,
  // The weekend edition's draft, written Thursday night by scripts/weekend-edition.mjs; the Weekend panel swaps picks.
  weekend: `${PREFIX}/weekend.json`,
  // City alerts with the AI's verdicts, written nightly by scripts/check-alerts.mjs; the City alerts panel confirms them.
  alerts: `${PREFIX}/alerts.json`,
  // Your Confirm / Drop on those, written only by the admin.
  alertDecisions: `${PREFIX}/alert-decisions.json`,
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
