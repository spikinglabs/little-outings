import { AUTO_GAPS } from "./answers.js";

// What parents wrote that needs a person to look at it: issues in INBOX_REPO, created by the
// site's /api/inbox. Taps (visits, chip answers) are counted, never reviewed, so they don't show here.
//   approve → adds the `approved` label (the nightly tally then shows a tip). An approved event is
//             also committed to the site repo as content/events/community/inbox-<number>.yaml and
//             the issue is closed, so it goes live with the deploy that commit starts. A suggested
//             place works the same way, as content/places/community/inbox-<number>.yaml.
//            An approved gap answer (hours, time, price) goes live with the next deploy, even alone.
//   done    → closes a report as completed, once you've fixed what it was about
//            (also an answer about where something is or whether it's still on, once you've fixed it)
//   reject  → closes as "not planned", so the tally ignores it for good

export const KINDS = {
  tip: { label: "Tip", actions: ["approve", "reject"] },
  report: { label: "Report", actions: ["done", "reject"] },
  "new-event": { label: "New event", actions: ["approve", "reject"] },
  "new-place": { label: "New place", actions: ["approve", "reject"] },
  answer: { label: "Answer", actions: ["approve", "reject"] },
};

/** What can be done with an item: an answer about where or "still on?" can't be published, only fixed by hand. */
export const actionsOf = (item) =>
  item.kind === "answer" && !AUTO_GAPS.includes(item.data.gap) ? ["done", "reject"] : KINDS[item.kind].actions;

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
  // Facility and "Do you need German?" answers are votes, counted by the tally, not reviewed.
  if (kind === "answer" && (data.gap === "fac" || data.gap === "lang" || !data.gap)) return null;
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

/**
 * Still waiting for a decision: open and not approved yet. A suggested event waits until it is
 * published (closed), so one approved before publishing existed still shows up to be approved again.
 */
export const waiting = (item) => item.open && (PUBLISHED.includes(item.kind) || !item.approved);

/** Suggestions that approving turns into a content file on the site. */
export const PUBLISHED = ["new-event", "new-place"];

const q = (v) => JSON.stringify(String(v ?? "").trim());

/** Town from a free-text place like "Rathaus, Valdersweg 1, 52399 Merzenich": the last part, without postcode. */
export function townOf(place) {
  const last = String(place ?? "").split(",").map((s) => s.trim()).filter(Boolean).pop() ?? "";
  return last.replace(/^(D-)?\d{5}\s+/, "").trim();
}

/**
 * The content file for an approved event suggestion, or an error message. Values are JSON-quoted,
 * which is valid YAML, so nothing a parent typed can change the file's structure.
 */
export function eventFile(number, d, approvedBy) {
  if (!d?.title) return { error: "This event has no title." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.date ?? ""))) return { error: `The date "${d.date ?? ""}" isn't YYYY-MM-DD; fix it before approving.` };
  const place = String(d.place ?? "").trim();
  const town = townOf(place) || place;
  if (!town) return { error: "This event has no place; add one before approving." };
  const venue = place.split(",")[0].trim();
  const price = String(d.price ?? "").trim();
  const free = /^(kostenlos|frei|eintritt frei|gratis|free|0 ?€?|免费)$/i.test(price);
  const lines = [
    `# Suggested by a parent (inbox #${number}), approved in the admin by ${String(approvedBy).replace(/\s+/g, " ")}.`,
    `# Edit here to fix it. If the sender edits it, approving again replaces this file.`,
    `title: ${q(d.title)}`,
    venue && venue !== town ? `venue: ${q(venue)}` : "",
    `town: ${q(town)}`,
    `start: ${q(d.date)}`,
    d.time ? `time: ${q(d.time)}` : "",
    free ? "price: { free: true }" : price ? `price: { free: false, text: ${q(price)} }` : "",
    d.note ? `note: ${q(d.note)}` : "",
    "trust: { level: community }",
  ];
  return { path: `content/events/community/inbox-${number}.yaml`, text: lines.filter(Boolean).join("\n") + "\n" };
}

// Same lists as src/content.config.ts (the admin can't import the site's Astro config).
const PLACE_KINDS = ["playground", "indoor", "park", "zoo", "farm", "pool", "museum", "cafe", "fun"];
const FEATURES = ["playground", "changing_table", "highchairs", "kids_menu", "toys", "animals", "stroller_friendly",
  "nursing_room", "indoor_play", "toilets", "farm_shop", "parking",
  "sandpit", "water_play", "swings", "slides", "climbing", "toddler_area", "shade", "benches", "fenced"];

/** The content file for an approved place suggestion, or an error message. */
export function placeFile(number, d, approvedBy) {
  if (!d?.name) return { error: "This place has no name." };
  if (!PLACE_KINDS.includes(d.type)) return { error: `"${d.type ?? ""}" isn't a kind of place the site knows.` };
  if (!String(d.town ?? "").trim()) return { error: "This place has no town; add one before approving." };
  const features = (Array.isArray(d.features) ? d.features : []).filter((f) => FEATURES.includes(f));
  const website = /^https?:\/\/[^\s]+\.[^\s]+$/.test(String(d.website ?? "").trim()) ? String(d.website).trim() : "";
  const lines = [
    `# Suggested by a parent (inbox #${number}), approved in the admin by ${String(approvedBy).replace(/\s+/g, " ")}.`,
    `# Edit here to fix it.`,
    `kind: ${d.type}`,
    `name: ${q(d.name)}`,
    `address: { ${d.street ? `street: ${q(d.street)}, ` : ""}town: ${q(d.town)} }`,
    features.length ? `facilities:\n${features.map((f) => `  ${f}: { status: "yes", confirmed: 1 }`).join("\n")}` : "",
    d.note ? `note: ${q(d.note)}` : "",
    website ? `website: ${q(website)}` : "",
    "trust: { level: community }",
  ];
  return { path: `content/places/community/inbox-${number}.yaml`, text: lines.filter(Boolean).join("\n") + "\n" };
}

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Creates or replaces one file in the site repo (GITHUB_TOKEN: Contents read and write). */
export async function putSiteFile(env, path, text, message) {
  const repo = env.GITHUB_REPO || "spikinglabs/little-outings";
  const branch = env.GITHUB_BRANCH || "main";
  const api = `https://api.github.com/repos/${repo}/contents/${path}`;
  const headers = { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "little-outings-admin" };
  const existing = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers });
  if (!existing.ok && existing.status !== 404) return { ok: false, status: existing.status };
  const sha = existing.ok ? (await existing.json()).sha : undefined;
  const put = await fetch(api, {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ message, content: base64(text), branch, ...(sha ? { sha } : {}) }),
  });
  return { ok: put.ok, status: put.status };
}

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
