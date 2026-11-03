// Commits one data file to the site repository through GitHub's contents API. The push starts the site's
// normal deploy, and git keeps the history.

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Writes `text` to `path` on the site's branch unless it is already there. Returns the commit URL, or null when unchanged. */
export async function commitFile(env, path, text, message) {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not set for the admin site.");
  const repo = env.GITHUB_REPO || "spikinglabs/little-outings";
  const branch = env.GITHUB_BRANCH || "main";
  const api = `https://api.github.com/repos/${repo}/contents/${path}`;
  const headers = { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "little-outings-admin" };
  const existing = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers });
  if (!existing.ok && existing.status !== 404) throw new Error(`GitHub refused to read ${path} (${existing.status}).`);
  const current = existing.ok ? await existing.json() : null;
  const content = base64(text);
  if (current?.content && current.content.replace(/\n/g, "") === content) return null;
  const put = await fetch(api, {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ message, content, branch, ...(current?.sha ? { sha: current.sha } : {}) }),
  });
  if (!put.ok) throw new Error(`GitHub refused the commit (${put.status}).`);
  return (await put.json()).commit?.html_url || null;
}

const WORKFLOW = "weekend-now.yml";

/** One call to the site repository's Actions API. */
async function actions(env, path, init = {}) {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not set for the admin site.");
  const repo = env.GITHUB_REPO || "spikinglabs/little-outings";
  return fetch(`https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "little-outings-admin", ...init.headers },
  });
}

const NEEDS_ACTIONS = "The admin's GITHUB_TOKEN may not start workflows yet: give it \"Actions: Read and write\" on the site repository.";

/** Starts the "Weekend edition now" workflow on the site's branch. */
export async function startWeekendNow(env) {
  const res = await actions(env, "/dispatches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ref: env.GITHUB_BRANCH || "main" }),
  });
  if (res.status === 403 || res.status === 404) throw new Error(NEEDS_ACTIONS);
  if (!res.ok) throw new Error(`GitHub refused to start the workflow (${res.status}).`);
}

/** The newest run of that workflow: { status, conclusion, started, url }, or null. */
export async function lastWeekendNow(env) {
  const res = await actions(env, `/runs?per_page=1&branch=${encodeURIComponent(env.GITHUB_BRANCH || "main")}`);
  if (res.status === 403 || res.status === 404) throw new Error(NEEDS_ACTIONS);
  if (!res.ok) throw new Error(`GitHub refused to list the runs (${res.status}).`);
  const run = (await res.json()).workflow_runs?.[0];
  return run ? { status: run.status, conclusion: run.conclusion, started: run.created_at, url: run.html_url } : null;
}
