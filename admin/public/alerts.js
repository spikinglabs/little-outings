// City alerts panel: what the nightly AI kept from city-anomalies' official notices. Confirm puts one on the
// site (that town's Discover and weekend pages), Drop hides it here, Undo takes a confirmed one off. Talks to /api/alerts.
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const LANGS = { zh: "Chinese", de: "German", en: "English" };
const TYPES = { demonstration: "Demonstration", march: "March", police_operation: "Police operation", closure: "Closure", strike: "Strike", evacuation: "Evacuation", crowd_event: "Big crowd event", other: "Other" };

let items = [], etag = null;

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
  const open = items.filter((it) => it.status !== "confirmed").length;
  $("alerts-count").textContent = open ? String(open) : "";
  const box = $("alerts");
  if (!items.length) {
    box.innerHTML = `<li class="sub">Nothing to check. New notices come with the nightly run.</li>`;
    return;
  }
  box.innerHTML = items.map((it) => `
    <li class="alert-item" data-id="${esc(it.id)}">
      <div><b>${esc(it.city)} · ${esc(when(it))}</b>
        ${it.type ? `<span class="badge edited">${esc(TYPES[it.type] ?? it.type)}</span>` : ""}
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

load();
