// Season lists panel: the yearly AI drafts of Christmas markets and fairs per town. Talks to /api/seasons.
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const day = (d) => d.slice(8, 10) + "." + d.slice(5, 7) + ".";

let drafts = [];

async function load() {
  try {
    const res = await fetch("/api/seasons");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    drafts = body.drafts ?? [];
    note("");
  } catch (error) {
    drafts = [];
    note(`Could not load the season lists: ${error.message}`, true);
  }
  render();
}

function note(text, error = false) {
  $("seasons-banner").hidden = !text;
  $("seasons-banner").classList.toggle("error", error);
  $("seasons-banner").textContent = text;
}

function rowHtml(d, it, i) {
  const what = [it.hours, [it.street, it.district].filter(Boolean).join(", "), it.kids?.join(", "), it.free ? "free" : ""].filter(Boolean);
  return `<li><label class="season-row">
    <input type="checkbox" data-row="${i}" checked>
    <span><b>${esc(it.name)}</b> · ${day(it.from)}–${day(it.to)}${it.geo ? "" : ' <span class="badge out">no pin</span>'}
      ${what.length ? `<br><span class="sub">${esc(what.join(" · "))}</span>` : ""}
      ${it.note?.de ? `<br><span class="sub">${esc(it.note.de)}</span>` : ""}
      ${it.website ? `<br><a href="${esc(it.website)}" target="_blank" rel="noopener noreferrer">${esc(it.website.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70))}</a>` : ""}
    </span>
  </label></li>`;
}

function draftHtml(d, n) {
  const done = d.approved_at ? `<span class="badge cleared">approved ${esc(d.approved_count)} rows</span>` : "";
  return `<details class="season-draft" ${d.approved_at ? "" : "open"} data-draft="${n}">
    <summary><b>${esc(d.townName)}</b> · ${esc(d.season)} · ${d.items.length} rows ${done}</summary>
    <p class="sub">From <a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc(d.source)}</a>.
      ${d.errors?.length ? `Some pages could not be read: ${esc(d.errors.slice(0, 3).join("; "))}` : ""}</p>
    <ol class="season-rows">${d.items.map((it, i) => rowHtml(d, it, i)).join("")}</ol>
    ${d.items.length ? `<button type="button" class="primary" data-approve="${n}">${d.approved_at ? "Approve again" : "Approve"} ${esc(d.townName)}</button>` : ""}
  </details>`;
}

function render() {
  $("seasons-panel").hidden = !drafts.length && $("seasons-banner").hidden;
  const waiting = drafts.filter((d) => !d.approved_at && d.items.length).length;
  $("seasons-count").textContent = waiting ? `${waiting} waiting` : "";
  $("seasons").innerHTML = drafts.map(draftHtml).join("");
}

async function approve(button) {
  const n = Number(button.dataset.approve);
  const d = drafts[n];
  const box = button.closest("[data-draft]");
  const items = [...box.querySelectorAll("[data-row]")].filter((c) => c.checked).map((c) => d.items[Number(c.dataset.row)]);
  button.disabled = true;
  try {
    const res = await fetch("/api/seasons", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ season: d.season, town: d.town, items }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    Object.assign(d, { approved_at: new Date().toISOString(), approved_count: body.count });
    note(`${d.townName}: ${body.count} rows committed to ${body.path}. They go live with the next deploy.`);
    render();
  } catch (error) {
    button.disabled = false;
    note(`Could not approve ${d.townName}: ${error.message}`, true);
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-approve]");
  if (button) approve(button);
});

load();
