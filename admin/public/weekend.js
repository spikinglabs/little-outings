// Weekend panel: the draft of this weekend's edition per town, from Thursday night until Friday's
// publish. Swap a pick for one of the alternates, drop one, or change its German line. Talks to /api/weekend.
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayOf = (d) => DAY[new Date(`${d}T12:00:00Z`).getUTCDay()];
const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });

let draft = null, etag = null;

const when = (p) => (p.type === "place" ? "Any time" : `${p.days.map(dayOf).join("+")} ${p.time ?? ""}`.trim());
const line = (p) => `${when(p)} · ${p.title}${p.venue ? ` · ${p.venue.split(",")[0]}` : ""}${p.free ? " · free" : ""}`;

async function load() {
  try {
    const res = await fetch("/api/weekend");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    ({ draft, etag } = body);
    note("");
  } catch (error) {
    note(`Could not load the weekend draft: ${error.message}`, true);
  }
  render();
}

function note(text, error = false) {
  $("weekend-banner").hidden = !text;
  $("weekend-banner").classList.toggle("error", error);
  $("weekend-banner").textContent = text;
}

function render() {
  const box = $("weekend");
  if (!draft) {
    $("weekend-when").textContent = "";
    box.innerHTML = `<p class="sub">No draft yet. The next one is made on Thursday night.</p>`;
    return;
  }
  $("weekend-when").textContent = `Weekend of ${draft.weekend}, drafted ${dateFmt.format(new Date(draft.drafted_at))}${
    draft.edited_at ? `, changed ${dateFmt.format(new Date(draft.edited_at))} by ${draft.edited_by}` : ""}.`;
  box.innerHTML = Object.entries(draft.towns).map(([town, d]) => `
    <section class="weekend-town" data-town="${esc(town)}">
      <h3>${esc(town)} <span class="badge out">${d.by === "ai" ? "picked by AI" : "picked by score"}</span></h3>
      <ol class="weekend-picks">
        ${d.picks.map((p, i) => `
          <li data-i="${i}">
            <div><b>${esc(line(p))}</b></div>
            <label class="visually-hidden" for="why-${esc(town)}-${i}">German line</label>
            <input id="why-${esc(town)}-${i}" data-why maxlength="140" value="${esc(p.why?.de ?? "")}" placeholder="Why it's a good pick (German); the AI writes it if empty">
            <div class="weekend-acts">
              <select data-swap aria-label="Swap for another">
                <option value="">Swap for…</option>
                ${d.alternates.map((a) => `<option value="${esc(a.id)}">${esc(line(a))}</option>`).join("")}
              </select>
              <button class="ghost" data-remove>Remove</button>
            </div>
          </li>`).join("")}
      </ol>
      ${d.picks.length < 8 ? `<select data-add aria-label="Add a pick"><option value="">Add a pick…</option>${
        d.alternates.map((a) => `<option value="${esc(a.id)}">${esc(line(a))}</option>`).join("")}</select>` : ""}
    </section>`).join("");
}

async function save(town, picks) {
  note("Saving…");
  try {
    const res = await fetch("/api/weekend", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ etag, towns: { [town]: { picks } } }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    ({ draft, etag } = body);
    note("Saved. It publishes on Friday morning as shown here.");
  } catch (error) {
    note(`Not saved: ${error.message}`, true);
  }
  render();
}

/** The town's picks as the panel shows them now, with one change applied. */
function picksOf(town, change = () => {}) {
  const picks = draft.towns[town].picks.map((p) => ({ id: p.id }));
  document.querySelectorAll(`.weekend-town[data-town="${CSS.escape(town)}"] [data-why]`).forEach((input, i) => { picks[i].why_de = input.value; });
  change(picks);
  return picks;
}

document.addEventListener("change", (ev) => {
  const el = ev.target;
  const section = el.closest?.(".weekend-town");
  if (!section) return;
  const town = section.dataset.town;
  const i = Number(el.closest("li")?.dataset.i);
  if (el.matches("[data-swap]") && el.value) save(town, picksOf(town, (p) => { p[i] = { id: el.value }; }));
  else if (el.matches("[data-add]") && el.value) save(town, picksOf(town, (p) => { p.push({ id: el.value }); }));
  else if (el.matches("[data-why]")) save(town, picksOf(town));
});
document.addEventListener("click", (ev) => {
  const el = ev.target.closest?.("[data-remove]");
  if (!el) return;
  const town = el.closest(".weekend-town").dataset.town;
  const i = Number(el.closest("li").dataset.i);
  if (draft.towns[town].picks.length <= 1) return note("Keep at least one pick.", true);
  save(town, picksOf(town, (p) => { p.splice(i, 1); }));
});

load();
