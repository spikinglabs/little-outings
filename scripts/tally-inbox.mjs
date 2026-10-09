// Counts what parents sent through the inbox, so place pages can show it without anyone copying numbers by hand.
// Reads every issue in INBOX_REPO and writes data/inbox-tallies.json (not committed):
//   { "<item id>": { fac: { changing_table: { yes, no } }, visits: { count, again, good_for }, tips: [{ topic, text }] } }
// - "answer" issues about a facility count as yes/no votes ("not sure" is ignored).
// - "visit" issues count as "We went" taps.
// - "tip" issues show only once a moderator adds the `approved` label, so nothing goes public unreviewed.
// - Issues closed as "not planned" (spam, nonsense) never count.
// Needs INBOX_REPO and INBOX_READ_TOKEN (fine-grained, Issues: read on that repo). Without them it writes {}.
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("../data/inbox-tallies.json", import.meta.url);
const { INBOX_REPO: repo, INBOX_READ_TOKEN: token } = process.env;

/** The YAML block the inbox function writes: one `key: value` per line, values JSON-quoted except `kind`. */
export function parseBody(body) {
  const m = /```yaml\n([\s\S]*?)\n```/.exec(body ?? "");
  if (!m) return null;
  const out = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(": ");
    if (i < 0) continue;
    const v = line.slice(i + 2);
    try { out[line.slice(0, i)] = JSON.parse(v); } catch { out[line.slice(0, i)] = v; } // `kind: answer` is bare
  }
  return out;
}

export function tally(issues) {
  const all = {};
  const of = (id) => (all[id] ??= {});
  for (const is of issues) {
    if (is.pull_request || is.state_reason === "not_planned") continue;
    const d = parseBody(is.body);
    if (!d || typeof d.item !== "string") continue;
    const labels = (is.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
    if (d.kind === "answer" && d.gap === "fac" && d.feature && (d.answer === "yes" || d.answer === "no")) {
      const fac = (of(d.item).fac ??= {});
      const v = (fac[d.feature] ??= { yes: 0, no: 0 });
      v[d.answer]++;
    } else if (d.kind === "visit") {
      const v = (of(d.item).visits ??= { count: 0, again: 0, good_for: {} });
      v.count++;
      if (d.again === "yes") v.again++;
      for (const g of Array.isArray(d.good_for) ? d.good_for : []) v.good_for[g] = (v.good_for[g] ?? 0) + 1;
    } else if (d.kind === "tip" && labels.includes("approved") && d.text) {
      (of(d.item).tips ??= []).push({ topic: d.topic, text: d.text });
    }
  }
  return all;
}

async function issues() {
  const rows = [];
  for (let page = 1; page < 100; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues?state=all&per_page=100&page=${page}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "little-outings-tally" },
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${repo}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
  if (!repo || !token) {
    console.log("INBOX_REPO or INBOX_READ_TOKEN not set; no inbox tallies.");
    writeFileSync(OUT, "{}\n");
  } else {
    const rows = await issues();
    const t = tally(rows);
    writeFileSync(OUT, JSON.stringify(t) + "\n");
    console.log(`Tallied ${rows.length} inbox issues for ${Object.keys(t).length} places and events.`);
  }
}
