// Usage box: what visitors did on the site, per week, from the anonymous daily counts. Talks to /api/usage.
import { weeklyUsage } from "./usage-table.js";

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const short = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

let rows = [];
let parse = null;

async function load() {
  try {
    const res = await fetch("/api/usage");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    rows = body.rows;
    parse = body.parse ?? null;
    $("usage-banner").hidden = true;
  } catch (error) {
    $("usage-banner").hidden = false;
    $("usage-banner").classList.add("error");
    $("usage-banner").textContent = `Could not load the counts: ${error.message}`;
  }
  render();
  renderParse();
}

function render() {
  const today = new Date().toISOString().slice(0, 10);
  const { weeks, rows: lines } = weeklyUsage(rows, today, { lang: $("usage-lang").value });
  if (!lines.length) {
    $("usage").innerHTML = `<p class="sub">Nothing counted in these four weeks yet.</p>`;
    return;
  }
  $("usage").innerHTML = `
    <div class="usage-wrap"><table class="usage">
      <thead><tr><th>Action</th>${weeks.map((w, i) => `<th>${i === 0 ? "This week" : `Week of ${esc(short(w))}`}</th>`).join("")}</tr></thead>
      <tbody>${lines.map((l) => `<tr><td>${esc(l.label)}</td>${l.counts.map((n) => `<td>${n || "–"}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
}

// What failure reasons mean, in words (functions/api/parse.ts, type Reason).
const REASONS = {
  no_credits: "AI credits or quota used up",
  provider_error: "AI service error",
  empty_answer: "AI gave no answer",
  unreadable_answer: "AI answer was not readable",
  link_failed: "could not open the link",
};
const INPUTS = { image: "Poster photo", url: "Link", text: "Pasted text" };

/** The poster reader on the Add tab: read vs failed per input in these 14 days, then the last failures. */
function renderParse() {
  const box = $("parse-log");
  if (!parse) { box.innerHTML = ""; return; }
  if (parse.error) { box.innerHTML = `<p class="sub">Poster reading log: ${esc(parse.error)}</p>`; return; }
  const sums = {};
  for (const c of parse.counts) {
    const s = (sums[c.input] ??= { ok: 0, fail: 0 });
    s[c.ok ? "ok" : "fail"] += c.n;
  }
  const lines = Object.entries(INPUTS).map(([k, label]) => {
    const s = sums[k] ?? { ok: 0, fail: 0 };
    return `<tr><td>${label}</td><td>${s.ok || "–"}</td><td>${s.fail ? `<strong>${s.fail}</strong>` : "–"}</td></tr>`;
  }).join("");
  const when = (at) => new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
  const fails = parse.failures.map((f) => `<li><strong>${esc(when(f.at))}</strong> · ${esc(INPUTS[f.input] ?? f.input)} · ${esc(REASONS[f.reason] ?? f.reason)}${f.provider ? ` (${esc(f.provider)})` : ""}<br><span class="sub">${esc(f.detail ?? "")}</span></li>`).join("");
  box.innerHTML = `
    <h3>Reading posters and links (Add tab), last ${parse.days} days</h3>
    <div class="usage-wrap"><table class="usage">
      <thead><tr><th>Sent</th><th>Read</th><th>Failed</th></tr></thead><tbody>${lines}</tbody>
    </table></div>
    ${fails ? `<p class="sub">Last failures (the poster or text itself is never kept):</p><ul class="parse-fails">${fails}</ul>` : `<p class="sub">No failures.</p>`}`;
}

$("usage-lang").addEventListener("change", render);
load();
