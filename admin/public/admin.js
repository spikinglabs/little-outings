import {
  EDITABLE, EDITABLE_LOCATION, familyMatch, fold, keywordsOf, matchesSearch, publishRows, rowState, sourceSummary,
  usesDetected,
} from "./apply.js";

const PAGE = 50;
const state = { candidates: [], decisions: null, etag: null, manifest: null, lastPublish: null, user: null, shown: PAGE };
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
const when = (iso) => (iso ? dateFmt.format(new Date(iso)) : "never");

// ---------- loading and saving ----------

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status });
  return body;
}

async function load() {
  try {
    const data = await api("/api/state");
    Object.assign(state, data, { shown: PAGE });
    banner("");
    fillFilterOptions();
    render();
  } catch (error) {
    banner(`Could not load the admin data: ${error.message}`, true);
  }
}

let saveTimer;
let saving = Promise.resolve();
function changed() {
  setSave("Unsaved changes…");
  render();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => (saving = saving.then(save)), 500);
}

async function save() {
  setSave("Saving…");
  try {
    const result = await api("/api/decisions", {
      method: "PUT",
      body: JSON.stringify({ decisions: state.decisions, etag: state.etag }),
    });
    state.etag = result.etag;
    state.decisions = result.decisions;
    setSave(`Saved ${when(result.decisions.updated_at)}`);
  } catch (error) {
    setSave("Not saved", true);
    banner(error.status === 409
      ? `${esc(error.message)} <button class="ghost" data-act="reload">Reload</button>`
      : `Saving failed: ${esc(error.message)}`, true, true);
  }
}

async function publish() {
  const count = publishRows(state.candidates, state.decisions).length;
  if (!window.confirm(`Publish ${count} outings to the live site?`)) return;
  await saving;
  $("publish").disabled = true;
  setSave("Publishing…");
  try {
    state.lastPublish = await api("/api/publish", { method: "POST", body: "{}" });
    setSave("Published");
    banner(`Published ${state.lastPublish.count} outings. The site rebuilds in a minute or two.${
      state.lastPublish.commit_url ? ` <a href="${esc(state.lastPublish.commit_url)}" target="_blank" rel="noopener">See the commit</a>` : ""}`, false, true);
  } catch (error) {
    setSave("Publish failed", true);
    banner(`Publishing failed: ${esc(error.message)}`, true, true);
  }
  render();
}

function setSave(text, error = false) {
  $("save").textContent = text;
  $("save").classList.toggle("error", error);
}

function banner(html, error = false, raw = false) {
  const el = $("banner");
  el.hidden = !html;
  el.classList.toggle("error", error);
  el.innerHTML = raw ? html : esc(html);
}

// ---------- decisions ----------

function eventEntry(id) {
  return (state.decisions.events[id] ||= {});
}

function tidy(id) {
  const entry = state.decisions.events[id];
  if (!entry) return;
  if (entry.edits && !Object.keys(entry.edits).length) delete entry.edits;
  if (entry.edits?.location && !Object.keys(entry.edits.location).length) delete entry.edits.location;
  if (!Object.keys(entry).length) delete state.decisions.events[id];
}

function setSource(id, mode) {
  if (mode === "auto") delete state.decisions.sources[id];
  else state.decisions.sources[id] = mode;
  changed();
}

function setKeywords(words) {
  state.decisions.keywords = words;
  changed();
}

function addKeyword(word) {
  word = word.trim();
  const words = keywordsOf(state.decisions);
  if (!word || words.some((w) => fold(w) === fold(word))) return;
  setKeywords([...words, word]);
}

/** Show every listed event that isn't published yet; hidden-by-you events stay hidden. */
function showAll(rows) {
  const targets = rows.filter((row) => !rowState(row, state.decisions).published && state.decisions.events[row.event_id]?.visibility !== "hide");
  if (!targets.length || !window.confirm(`Show all ${targets.length} listed events that aren't published yet?`)) return;
  for (const row of targets) eventEntry(row.event_id).visibility = "show";
  changed();
}

function setVisibility(id, visibility) {
  const entry = eventEntry(id);
  if (visibility === "default") delete entry.visibility;
  else entry.visibility = visibility;
  tidy(id);
  changed();
}

// ---------- rendering ----------

function render() {
  if (!state.decisions) return;
  const { candidates, decisions, manifest, lastPublish, user } = state;
  const published = publishRows(candidates, decisions).length;
  const edited = Object.values(decisions.events).filter((e) => e.edits).length;
  $("who").textContent = `Signed in as ${user?.email || "?"} · candidates from ${when(manifest?.generated_at)}`;
  $("publish").disabled = !candidates.length;
  $("publish").textContent = `Publish ${published}`;

  const matches = candidates.filter((row) => familyMatch(row, decisions, decisions.events[row.event_id]?.edits).matched).length;
  $("stats").innerHTML = [
    [candidates.length, "upcoming events found"],
    [matches, "match your keywords"],
    [published, "will be published"],
    [manifest?.duplicates_count ?? 0, "duplicate listings merged"],
    [edited, "events you corrected"],
    [lastPublish ? lastPublish.count : "–", `last published ${when(lastPublish?.published_at)}`],
  ].map(([n, label]) => `<div class="stat"><b>${esc(n)}</b><span>${esc(label)}</span></div>`).join("");

  if (!candidates.length) {
    banner("No candidates yet. They appear after cityklub's next export run writes them to the Little Outings bucket.");
  }
  renderKeywords();
  renderSources();
  renderEvents();
}

function renderKeywords() {
  const counts = new Map();
  for (const row of state.candidates) for (const word of familyMatch(row, state.decisions).words) counts.set(word, (counts.get(word) || 0) + 1);
  $("keywords").innerHTML = keywordsOf(state.decisions).map((word) =>
    `<li><span>${esc(word)} <small>${counts.get(fold(word)) || 0}</small></span><button type="button" data-act="unkeyword" data-word="${esc(word)}" aria-label="Remove ${esc(word)}">×</button></li>`,
  ).join("") || '<li class="sub">No keywords. Only events you Show by hand will be published.</li>';
  $("use-detected").checked = usesDetected(state.decisions);
}

function renderSources() {
  const rows = sourceSummary(state.candidates, state.decisions);
  const seg = (id, current) =>
    ["auto", "include", "exclude"].map((mode) =>
      `<button type="button" data-act="source" data-id="${esc(id)}" data-mode="${mode}" aria-pressed="${current === mode}">${
        { auto: "Default", include: "Include", exclude: "Exclude" }[mode]}</button>`).join("");
  $("sources").innerHTML = `<thead><tr><th>Source</th><th class="hide-narrow">Rights</th><th class="num">Found</th><th class="num">Published</th><th>Setting</th></tr></thead><tbody>${
    rows.map((s) => {
      const chosen = state.decisions.sources[s.id] || "auto";
      return `<tr><td>${esc(s.name)}<br><small class="sub">${esc(s.id)}</small></td>
        <td class="hide-narrow">${s.cleared ? '<span class="badge cleared">cleared</span>' : '<span class="badge private">private only</span>'}</td>
        <td class="num">${s.candidates}</td><td class="num">${s.published}</td>
        <td><div class="seg" role="group" aria-label="Setting for ${esc(s.name)}">${seg(s.id, chosen)}</div></td></tr>`;
    }).join("") || '<tr><td colspan="5" class="sub">No sources yet.</td></tr>'
  }</tbody>`;
}

function filtered() {
  const form = new FormData($("filters"));
  const q = String(form.get("q") || "");
  const source = form.get("source");
  const town = form.get("town");
  const show = form.get("state");
  return state.candidates.filter((row) => {
    const entry = state.decisions.events[row.event_id];
    if (source && row.source_id !== source) return false;
    if (town && row.location?.city !== town) return false;
    if (show === "published" && !rowState(row, state.decisions).published) return false;
    if (show === "unpublished" && rowState(row, state.decisions).published) return false;
    if (show === "changed" && !entry) return false;
    if (show === "duplicates" && !row.also_listed?.length) return false;
    if (show === "match" && !familyMatch(row, state.decisions, entry?.edits).matched) return false;
    if (show === "nomatch" && familyMatch(row, state.decisions, entry?.edits).matched) return false;
    if (show === "noaddress" && (entry?.edits?.location?.street || row.location?.street)) return false;
    if (!matchesSearch(row, q, entry?.edits)) return false;
    return true;
  });
}

function renderEvents() {
  const rows = filtered();
  $("count").textContent = `${rows.length} of ${state.candidates.length} events`;
  $("events").innerHTML = rows.slice(0, state.shown).map(eventHtml).join("");
  $("more").hidden = rows.length <= state.shown;
  const waiting = rows.filter((row) => !rowState(row, state.decisions).published && state.decisions.events[row.event_id]?.visibility !== "hide").length;
  const all = $("show-all");
  all.hidden = !waiting || rows.length === state.candidates.length;
  all.textContent = `Show all ${waiting} listed`;
  state.listed = rows;
}

function eventHtml(row) {
  const entry = state.decisions.events[row.event_id] || {};
  const view = { ...row, ...(entry.edits || {}), location: { ...row.location, ...(entry.edits?.location || {}) } };
  const st = rowState(row, state.decisions);
  const match = familyMatch(row, state.decisions, entry.edits);
  const why = [...match.words, ...(match.detected ? ["description or farm source"] : [])];
  const day = new Date(`${row.start_date}T12:00:00`);
  const address = [[view.location.street, view.location.house_number].filter(Boolean).join(" "), view.location.postal_code, view.location.city]
    .filter(Boolean).join(", ");
  const vis = entry.visibility || "default";
  const seg = ["default", "show", "hide"].map((v) =>
    `<button type="button" data-act="visibility" data-id="${esc(row.event_id)}" data-mode="${v}" aria-pressed="${vis === v}">${
      { default: "Default", show: "Show", hide: "Hide" }[v]}</button>`).join("");
  return `<li class="event${st.published ? "" : " off"}">
    <div class="stamp"><b>${day.getDate()}</b><span>${esc(day.toLocaleDateString("de-DE", { month: "short" }))}</span></div>
    <div class="event-body">
      <h3>${esc(view.title)}</h3>
      <p>${esc([view.venue, address].filter(Boolean).join(" · ") || "No venue or address")}${view.time_text ? ` · ${esc(view.time_text)}` : ""}</p>
      <div class="meta">
        ${row.cleared ? '<span class="badge cleared">cleared</span>' : '<span class="badge private">private only</span>'}
        <span class="badge out">${esc(row.source_name)}</span>
        ${why.length ? `<span class="badge match">${esc(why.join(", "))}</span>` : ""}
        ${st.published ? "" : `<span class="badge out">${esc(st.reason)}</span>`}
        ${entry.edits ? '<span class="badge edited">edited</span>' : ""}
        ${row.also_listed?.length ? `<span class="badge out">also in ${row.also_listed.length} other listing${row.also_listed.length > 1 ? "s" : ""}</span>` : ""}
        <a href="${esc(row.source_url)}" target="_blank" rel="noopener noreferrer">source</a>
      </div>
      ${entry.note ? `<p>Note: ${esc(entry.note)}</p>` : ""}
    </div>
    <div class="event-actions">
      <div class="seg" role="group" aria-label="Visibility">${seg}</div>
      <button type="button" class="ghost" data-act="edit" data-id="${esc(row.event_id)}">Edit</button>
    </div>
  </li>`;
}

function fillFilterOptions() {
  const sources = sourceSummary(state.candidates, state.decisions);
  const towns = [...new Set(state.candidates.map((r) => r.location?.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
  const sel = $("filters").elements;
  sel.source.innerHTML = '<option value="">All sources</option>' + sources.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
  sel.town.innerHTML = '<option value="">All towns</option>' + towns.map((t) => `<option>${esc(t)}</option>`).join("");
}

// ---------- editing ----------

let editing = null;
function openEditor(id) {
  const row = state.candidates.find((r) => r.event_id === id);
  if (!row) return;
  editing = row;
  const entry = state.decisions.events[id] || {};
  const form = $("edit-form").elements;
  for (const key of EDITABLE) form[key].value = entry.edits?.[key] ?? row[key] ?? "";
  for (const key of EDITABLE_LOCATION) form[key].value = entry.edits?.location?.[key] ?? row.location?.[key] ?? "";
  form.note.value = entry.note || "";
  $("edit-source").textContent = `${row.source_name} · ${row.start_date}`;
  $("editor").showModal();
}

$("editor").addEventListener("close", () => {
  const action = $("editor").returnValue;
  const row = editing;
  editing = null;
  if (!row || (action !== "save" && action !== "reset")) return;
  const entry = eventEntry(row.event_id);
  if (action === "reset") {
    delete entry.edits;
  } else {
    const form = $("edit-form").elements;
    const edits = {};
    for (const key of EDITABLE) {
      const value = form[key].value.trim();
      if (value !== (row[key] ?? "")) edits[key] = value;
    }
    for (const key of EDITABLE_LOCATION) {
      const value = form[key].value.trim();
      if (value !== (row.location?.[key] ?? "")) (edits.location ||= {})[key] = value;
    }
    if (Object.keys(edits).length) entry.edits = edits;
    else delete entry.edits;
    const note = form.note.value.trim();
    if (note) entry.note = note;
    else delete entry.note;
  }
  tidy(row.event_id);
  changed();
});

// ---------- events ----------

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-act]");
  if (!button) return;
  const { act, id, mode } = button.dataset;
  if (act === "source") setSource(id, mode);
  else if (act === "visibility") setVisibility(id, mode);
  else if (act === "edit") openEditor(id);
  else if (act === "reload") load();
  else if (act === "unkeyword") setKeywords(keywordsOf(state.decisions).filter((w) => w !== button.dataset.word));
});
$("keyword-form").addEventListener("submit", (event) => {
  event.preventDefault();
  addKeyword($("keyword-input").value);
  $("keyword-input").value = "";
});
$("use-detected").addEventListener("change", (event) => {
  state.decisions.use_detected = event.target.checked;
  changed();
});
$("show-all").addEventListener("click", () => showAll(state.listed || []));
$("filters").addEventListener("input", () => { state.shown = PAGE; renderEvents(); });
$("filters").addEventListener("submit", (event) => event.preventDefault());
$("more").addEventListener("click", () => { state.shown += PAGE; renderEvents(); });
$("publish").addEventListener("click", publish);
window.addEventListener("beforeunload", (event) => {
  if ($("save").textContent.startsWith("Unsaved") || $("save").textContent === "Saving…") event.preventDefault();
});

load();
