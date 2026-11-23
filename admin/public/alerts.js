// City alerts panel: what the nightly AI kept from city-anomalies' official notices. Confirm puts one on the
// site (that town's Discover and weekend pages), Drop hides it here, Undo takes a confirmed one off. Talks to /api/alerts.
import { passesFilter, sizeOf } from "./alert-filter.js";

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const LANGS = { zh: "Chinese", de: "German", en: "English" };
const TYPES = { demonstration: "Demonstration", march: "March", police_operation: "Police operation", closure: "Closure", strike: "Strike", evacuation: "Evacuation", crowd_event: "Big crowd event", other: "Other" };

const SIZES = { few: "Under 100", hundreds: "Hundreds", thousands: "Thousands", huge: "10,000+" };
const IMPACTS = { none: "No effect on getting around", spot: "One street or square", area: "Several streets", city: "City-wide" };
// Hides small and harmless ones by default; your choice is kept in this browser.
const FILTER_KEY = "outings-admin-alert-filter";
const DEFAULT_FILTER = { size: "hundreds", impact: "spot", unknown: true };

let items = [], etag = null;
let filter = readFilter();

function readFilter() {
  try { return { ...DEFAULT_FILTER, ...JSON.parse(localStorage.getItem(FILTER_KEY) || "{}") }; } catch { return { ...DEFAULT_FILTER }; }
}

function showFilter() {
  const form = $("alerts-filter");
  form.size.value = filter.size;
  form.impact.value = filter.impact;
  form.unknown.checked = filter.unknown;
}

$("alerts-filter").addEventListener("change", () => {
  const form = $("alerts-filter");
  filter = { size: form.size.value, impact: form.impact.value, unknown: form.unknown.checked };
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(filter)); } catch { /* not kept, still works */ }
  render();
});
$("alerts-filter").addEventListener("submit", (ev) => ev.preventDefault());

async function load() {
  try {
    const res = await fetch("/api/alerts");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    ({ items, etag } = body);
    $("alerts-when").textContent = body.updated_at ? `Last checked ${dateFmt.format(new Date(body.updated_at))}.` : "";
    note("");
  } catch (error) {
    note(`Could not load the city alerts: ${error.message}`, true);
  }
  render();
}

function note(text, error = false) {
  $("alerts-banner").hidden = !text;
  $("alerts-banner").classList.toggle("error", error);
  $("alerts-banner").textContent = text;
}

const when = (it) => [it.day ? dayFmt.format(new Date(`${it.day}T12:00:00Z`)) : "no day yet",
  it.until ? `– ${dayFmt.format(new Date(`${it.until}T12:00:00Z`))}` : "", it.from ? `${it.from}${it.to ? `–${it.to}` : ""}` : ""].filter(Boolean).join(" ");

function render() {
  const shown = items.filter((it) => passesFilter(it, filter));
  const open = shown.filter((it) => it.status !== "confirmed").length;
  const hidden = items.length - shown.length;
  $("alerts-count").textContent = open ? String(open) : "";
  $("alerts-hidden").textContent = hidden ? `${hidden} hidden by the filter` : "";
  const box = $("alerts");
  if (!shown.length) {
    box.innerHTML = `<li class="sub">${items.length ? "Nothing passes the filter." : "Nothing to check."} New notices come with the nightly run.</li>`;
    return;
  }
  box.innerHTML = shown.map((it) => `
    <li class="alert-item" data-id="${esc(it.id)}">
      <div><b>${esc(it.city)} · ${esc(when(it))}</b>
        ${it.type ? `<span class="badge edited">${esc(TYPES[it.type] ?? it.type)}</span>` : ""}
        ${it.expected ? `<span class="badge">${esc(SIZES[sizeOf(it.expected)])}</span>` : it.size ? `<span class="badge">${esc(SIZES[it.size] ?? it.size)} (AI estimate)</span>` : ""}
        ${it.impact ? `<span class="badge">${esc(IMPACTS[it.impact] ?? it.impact)}</span>` : ""}
        <span class="badge ${it.status === "confirmed" ? "cleared" : "out"}">${it.status === "confirmed" ? "on the site" : `AI: ${esc(it.verdict)}`}</span></div>
      <div class="sub"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>${it.where ? ` · ${esc(it.where)}` : ""}</div>
      <div class="alert-when">
        <label>Day <input type="date" data-k="day" value="${esc(it.day ?? "")}"></label>
        <label>Until <input type="date" data-k="until" value="${esc(it.until ?? "")}"></label>
        <label>From <input type="time" data-k="from" value="${esc(it.from ?? "")}"></label>
        <label>To <input type="time" data-k="to" value="${esc(it.to ?? "")}"></label>
        <label>People expected <input type="number" min="1" inputmode="numeric" data-k="expected" value="${esc(it.expected ?? "")}"></label>
        <label>Lines affected <input data-k="lines" value="${esc((it.lines ?? []).join(", "))}" placeholder="KVB 1, KVB 7"></label>
        <label class="wide">Where <input data-k="where" maxlength="300" value="${esc(it.where ?? "")}"></label>
        <label class="wide">Route <input data-k="route" maxlength="300" value="${esc(it.route ?? "")}" placeholder="for a march: streets in order"></label>
      </div>
      ${Object.entries(LANGS).map(([l, name], n) => `
        <details class="alert-lang" ${n === 0 ? "open" : ""}>
          <summary>${name}</summary>
          <label>Line <textarea data-line="${l}" maxlength="160" rows="2">${esc(it.line?.[l] ?? "")}</textarea></label>
          <label>Background <textarea data-about="${l}" maxlength="300" rows="3" placeholder="What it is about, who organises it">${esc(it.about?.[l] ?? "")}</textarea></label>
          <label>Key points, one per line <textarea data-points="${l}" rows="4" placeholder="Closed streets, diverted lines, when it ends">${esc((it.points?.[l] ?? []).join("\n"))}</textarea></label>
        </details>`).join("")}
      <div class="weekend-acts">
        ${it.status === "confirmed"
          ? `<button class="primary" data-act="confirmed">Save changes</button><button class="ghost" data-act="new">Take off the site</button>`
          : `<button class="primary" data-act="confirmed">Confirm</button><button class="ghost" data-act="dropped">Drop</button>`}
      </div>
    </li>`).join("");
}

async function decide(li, status) {
  const body = { etag, id: li.dataset.id, status, line: {}, about: {}, points: {} };
  li.querySelectorAll("[data-line]").forEach((input) => { body.line[input.dataset.line] = input.value; });
  li.querySelectorAll("[data-about]").forEach((input) => { body.about[input.dataset.about] = input.value; });
  li.querySelectorAll("[data-points]").forEach((input) => { body.points[input.dataset.points] = input.value.split("\n"); });
  li.querySelectorAll("[data-k]").forEach((input) => { body[input.dataset.k] = input.value; });
  body.lines = body.lines.split(",");
  note("Saving…");
  try {
    const res = await fetch("/api/alerts", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const reply = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(reply.error || `Request failed (${res.status})`);
    ({ items, etag } = reply);
    note(reply.warning || (status === "confirmed" ? "Saved. It is on the site after the deploy (a few minutes), and its Rednote poster set shows up in the Rednote panel then." : status === "new" ? "Taken off the site." : "Dropped."), !!reply.warning);
  } catch (error) {
    note(`Not saved: ${error.message}`, true);
  }
  render();
}

document.addEventListener("click", (ev) => {
  const btn = ev.target.closest?.("#alerts [data-act]");
  if (btn) decide(btn.closest("li"), btn.dataset.act);
});

showFilter();
load();
