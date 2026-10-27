// Usage box: what visitors did on the site, per week, from the anonymous daily counts. Talks to /api/usage.
import { weeklyUsage } from "./usage-table.js";

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const short = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

let rows = [];

async function load() {
  try {
    const res = await fetch("/api/usage");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    rows = body.rows;
    $("usage-banner").hidden = true;
  } catch (error) {
    $("usage-banner").hidden = false;
    $("usage-banner").classList.add("error");
    $("usage-banner").textContent = `Could not load the counts: ${error.message}`;
  }
  render();
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

$("usage-lang").addEventListener("change", render);
load();
