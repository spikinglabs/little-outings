import { publishRows, toJsonl } from "../../public/apply.js";
import { KEYS, json, readCandidates, readDecisions, readJson } from "../../lib/store.js";

// Commits the published outings to the site repository as a data file. The push
// starts the site's normal deploy, and git keeps the history of every publish.
// The nightly sort (scripts/sort-events.mjs) writes the same file without this button.
const PATH = "data/outings.jsonl";

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function onRequestPost({ env, data }) {
  if (!env.OUTINGS) return json({ error: "The OUTINGS bucket binding is missing." }, 500);
  if (!env.GITHUB_TOKEN) return json({ error: "GITHUB_TOKEN is not set for the admin site." }, 500);
  const repo = env.GITHUB_REPO || "spikinglabs/little-outings";
  const branch = env.GITHUB_BRANCH || "main";

  const [{ rows: candidates, manifest }, { decisions }, sorted] = await Promise.all([
    readCandidates(env.OUTINGS),
    readDecisions(env.OUTINGS),
    readJson(env.OUTINGS, KEYS.sorted),
  ]);
  if (!candidates.length) return json({ error: "There are no candidates yet." }, 409);
  const rows = publishRows(candidates, decisions, sorted);

  const api = `https://api.github.com/repos/${repo}/contents/${PATH}`;
  const headers = {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: "application/vnd.github+json",
    "user-agent": "little-outings-admin",
  };
  const existing = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers });
  if (!existing.ok && existing.status !== 404) {
    return json({ error: `GitHub refused to read ${PATH} (${existing.status}).` }, 502);
  }
  const sha = existing.ok ? (await existing.json()).sha : undefined;
  const put = await fetch(api, {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      message: `Publish ${rows.length} outings from the admin`,
      content: base64(toJsonl(rows)),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!put.ok) return json({ error: `GitHub refused the commit (${put.status}).` }, 502);
  const commit = (await put.json()).commit;

  const record = {
    published_at: new Date().toISOString(),
    published_by: data.user.email,
    count: rows.length,
    candidates_generated_at: manifest?.generated_at || null,
    commit_url: commit?.html_url || null,
  };
  await env.OUTINGS.put(KEYS.lastPublish, JSON.stringify(record, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  return json(record);
}
