// Counts what parents sent, so place pages can show it without anyone copying numbers by hand.
// Taps (chip votes, "We went") live in Cloudflare D1 behind /api/taps; older ones and all tips are
// issues in INBOX_REPO. Both are summed into data/inbox-tallies.json (not committed):
//   { "<item id>": { fac: { changing_table: { yes, no } }, visits: { count, again, good_for }, tips: [{ topic, text }],
//                    lang: { none, en, de }, answers: { hours: "Mo-Fr 9-17", where: "…", whereAt: { lat, lon, place? } },
//                    asks: { where: [{ value, count, at? }] } } }
// - "answer" issues about a facility count as yes/no votes ("not sure" is ignored).
// - "answer" issues about opening hours, time, price or where go live once two browsers agree, or once a
//   moderator approves one in the admin (rules in admin/lib/answers.js). The rest wait in the admin Inbox,
//   and show on the page as `asks` ("another parent said …", one tap to confirm) when the text is harmless.
// - "visit" issues count as "We went" taps.
// - "tip" issues show only once a moderator adds the `approved` label, so nothing goes public unreviewed.
// - Issues closed as "not planned" (spam, nonsense) never count.
// Taps need SITE_URL (the live site). Issues need INBOX_REPO and INBOX_READ_TOKEN (fine-grained,
// Issues: read on that repo). Whatever is missing or unreachable is skipped, never fatal.
import { mkdirSync, writeFileSync } from "node:fs";
import { AUTO_GAPS, agreement, answerOf, showable } from "../admin/lib/answers.js";

const OUT = new URL("../data/inbox-tallies.json", import.meta.url);
const { INBOX_REPO: repo, INBOX_READ_TOKEN: token, SITE_URL: site } = process.env;

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
  const asked = new Map(); // "item gap" → answers, oldest first
  for (const is of [...issues].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))) {
    if (is.pull_request || is.state_reason === "not_planned") continue;
    const d = parseBody(is.body);
    if (!d || typeof d.item !== "string") continue;
    const labels = (is.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
    if (d.kind === "answer" && d.gap === "fac" && d.feature && (d.answer === "yes" || d.answer === "no")) {
      const fac = (of(d.item).fac ??= {});
      const v = (fac[d.feature] ??= { yes: 0, no: 0 });
      v[d.answer]++;
    } else if (d.kind === "answer" && d.gap === "lang" && ["none", "en", "de"].includes(d.answer)) {
      const v = (of(d.item).lang ??= {});
      v[d.answer] = (v[d.answer] ?? 0) + 1;
    } else if (d.kind === "answer" && AUTO_GAPS.includes(d.gap)) {
      const k = `${d.item} ${d.gap}`;
      if (!asked.has(k)) asked.set(k, []);
      asked.get(k).push(answerOf(d, is.number, labels.includes("approved")));
    } else if (d.kind === "visit") {
      const v = (of(d.item).visits ??= { count: 0, again: 0, good_for: {} });
      v.count++;
      if (d.again === "yes") v.again++;
      for (const g of Array.isArray(d.good_for) ? d.good_for : []) v.good_for[g] = (v.good_for[g] ?? 0) + 1;
    } else if (d.kind === "tip" && labels.includes("approved") && d.text) {
      (of(d.item).tips ??= []).push({ topic: d.topic, text: d.text, ...(d.by ? { by: String(d.by) } : {}), ...(d.by && /^[0-9a-f]{8}$/.test(d.by_id) ? { byId: d.by_id } : {}) });
    }
  }
  for (const [k, answers] of asked) {
    const [item, gap] = k.split(" ");
    const a = agreement(gap, answers);
    if (a.status === "agreed" || a.status === "approved") {
      const ans = (of(item).answers ??= {});
      ans[gap] = a.value;
      if (a.at) ans.whereAt = a.at;
    } else if (a.status === "single" || a.status === "conflict") {
      const asks = a.options.filter((o) => showable(gap, o.value)).slice(0, 3)
        .map((o) => ({ value: o.value, count: o.count, ...(o.at ? { at: o.at } : {}) }));
      if (asks.length) (of(item).asks ??= {})[gap] = asks;
    }
  }
  return all;
}

/** Adds the live tap counts (same shape, minus tips) onto the inbox tally. */
export function addCounts(all, counts) {
  for (const [id, c] of Object.entries(counts ?? {})) {
    const t = (all[id] ??= {});
    for (const [f, v] of Object.entries(c.fac ?? {})) {
      const x = ((t.fac ??= {})[f] ??= { yes: 0, no: 0 });
      x.yes += v.yes; x.no += v.no;
    }
    for (const [k, n] of Object.entries(c.lang ?? {})) (t.lang ??= {})[k] = (t.lang[k] ?? 0) + n;
    if (c.visits) {
      const x = (t.visits ??= { count: 0, again: 0, good_for: {} });
      x.count += c.visits.count; x.again += c.visits.again;
      for (const [g, n] of Object.entries(c.visits.good_for)) x.good_for[g] = (x.good_for[g] ?? 0) + n;
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
  let all = {};
  if (repo && token) {
    try {
      const rows = await issues();
      all = tally(rows);
      console.log(`Tallied ${rows.length} inbox issues.`);
    } catch (e) { console.log(`::warning::Inbox not counted: ${e.message}`); }
  } else console.log("INBOX_REPO or INBOX_READ_TOKEN not set; inbox issues not counted.");
  if (site) {
    try {
      const res = await fetch(`${site.replace(/\/$/, "")}/api/taps?all=1`);
      if (res.ok) { addCounts(all, await res.json()); console.log("Added live tap counts."); }
      else console.log(`Tap counts not available (${res.status}).`);
    } catch (e) { console.log(`::warning::Tap counts not fetched: ${e.message}`); }
  }
  writeFileSync(OUT, JSON.stringify(all) + "\n");
}
