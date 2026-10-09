// What parents wrote that needs a person to look at it: issues in INBOX_REPO, created by the
// site's /api/inbox. Taps (visits, chip answers) are counted, never reviewed, so they don't show here.
//   approve → adds the `approved` label (the nightly tally then shows a tip; the inbox repo's bot
//             turns an approved event or place into a pull request)
//   done    → closes a report as completed, once you've fixed what it was about
//   reject  → closes as "not planned", so the tally ignores it for good

export const KINDS = {
  tip: { label: "Tip", actions: ["approve", "reject"] },
  report: { label: "Report", actions: ["done", "reject"] },
  "new-event": { label: "New event", actions: ["approve", "reject"] },
  "new-place": { label: "New place", actions: ["approve", "reject"] },
};

/** The YAML block the inbox function writes (same reader as scripts/tally-inbox.mjs). */
export function parseBody(body) {
  const m = /```yaml\n([\s\S]*?)\n```/.exec(body ?? "");
  if (!m) return null;
  const out = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(": ");
    if (i < 0) continue;
    const v = line.slice(i + 2);
    try { out[line.slice(0, i)] = JSON.parse(v); } catch { out[line.slice(0, i)] = v; }
  }
  return out;
}

const labelsOf = (issue) => (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));

/** A reviewable inbox item, or null for taps, pull requests and anything unreadable. */
export function reviewItem(issue) {
  if (!issue || issue.pull_request) return null;
  const labels = labelsOf(issue);
  const kind = Object.keys(KINDS).find((k) => labels.includes(k));
  const data = kind && parseBody(issue.body);
  if (!data) return null;
  return {
    number: issue.number,
    kind,
    data,
    open: issue.state === "open",
    approved: labels.includes("approved"),
    created_at: issue.created_at,
    url: issue.html_url,
  };
}

/** Still waiting for a decision: open and not approved yet. */
export const waiting = (item) => item.open && !item.approved;

export function github(env) {
  const repo = env.INBOX_REPO;
  const headers = {
    authorization: `Bearer ${env.INBOX_TOKEN}`,
    accept: "application/vnd.github+json",
    "user-agent": "little-outings-admin",
  };
  const call = (path, init = {}) =>
    fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: init.body ? { ...headers, "content-type": "application/json" } : headers,
    });
  return { repo, call };
}

const textOf = (t) => (typeof t === "string" ? t : t?.de || t?.en || Object.values(t ?? {})[0] || "");

/** id → { name, url } for every place and upcoming event on the live site, from its public JSON. */
export function sitePages(site, places = [], events = []) {
  const pages = new Map();
  for (const p of places) pages.set(p.id, { name: p.name, url: `${site}/de/orte/${p.id}/` });
  for (const e of events) pages.set(e.id, { name: textOf(e.title), url: `${site}/de/termine/${e.id}/` });
  return pages;
}
