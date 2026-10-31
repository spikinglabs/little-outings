// Recalls panel: what the nightly AI kept from recall-tracker's German recalls. Confirm puts one on the site
// (Discover, weekend pages, the Recalls page, a Rednote set), Drop hides it here, "Take off the site" undoes a
// confirm. Talks to /api/recalls.
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const LANGS = { zh: "Chinese", de: "German", en: "English" };
const KINDS = { baby_food: "Baby food", food: "Food", toy: "Toy", kids_product: "Children's product", cosmetics: "Cosmetics", other: "Other" };
const SHOW_DAYS = 30;
const plus = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

let items = [], etag = null;

async function load() {
  try {
    const res = await fetch("/api/recalls");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    ({ items, etag } = body);
    $("recalls-when").textContent = body.updated_at ? `Last checked ${dateFmt.format(new Date(body.updated_at))}.` : "";
    note("");
  } catch (error) {
    note(`Could not load the recalls: ${error.message}`, true);
  }
  render();
}

function note(text, error = false) {
  $("recalls-banner").hidden = !text;
  $("recalls-banner").classList.toggle("error", error);
  $("recalls-banner").textContent = text;
}

const states = (it) => (it.states === "all" ? "all of Germany" : (it.states ?? []).join(", "));

function render() {
  const open = items.filter((it) => it.status !== "confirmed").length;
  $("recalls-count").textContent = open ? String(open) : "";
  const box = $("recalls");
  if (!items.length) {
    box.innerHTML = `<li class="sub">Nothing to check. New recalls come with the nightly run.</li>`;
    return;
  }
  box.innerHTML = items.map((it) => `
    <li class="alert-item" data-id="${esc(it.id)}">
      <div><b>${esc(it.product?.en || it.title)}</b>
        <span class="badge edited">${esc(KINDS[it.kind] ?? it.kind ?? "")}</span>
        <span class="badge ${it.status === "confirmed" ? "cleared" : "out"}">${it.status === "confirmed" ? "on the site" : `AI: ${esc(it.verdict)}`}</span></div>
      <div class="sub">${it.published ? esc(dayFmt.format(new Date(`${it.published}T12:00:00Z`))) : ""} · <a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>${it.states ? ` · ${esc(states(it))}` : ""}${it.company ? ` · ${esc(it.company)}` : ""}</div>
      <div class="alert-when">
        <label class="wide">Stores <input data-k="stores" value="${esc((it.stores ?? []).join(", "))}" placeholder="Action, Kaufland"></label>
        <label>Show until <input type="date" data-k="until" value="${esc(it.until || (it.published ? plus(it.published, SHOW_DAYS) : ""))}"></label>
      </div>
      ${Object.entries(LANGS).map(([l, name], n) => `
        <details class="alert-lang" ${n === 0 ? "open" : ""}>
          <summary>${name}</summary>
          <label>Product <input data-t="product" data-l="${l}" maxlength="80" value="${esc(it.product?.[l] ?? "")}"></label>
          <label>Reason <input data-t="reason" data-l="${l}" maxlength="100" value="${esc(it.reason?.[l] ?? "")}"></label>
          <label>Line <textarea data-t="line" data-l="${l}" maxlength="160" rows="2">${esc(it.line?.[l] ?? "")}</textarea></label>
          <label>Check at home, one per line <textarea data-list="check" data-l="${l}" rows="3" placeholder="Best-before date, lot, barcode">${esc((it.check?.[l] ?? []).join("\n"))}</textarea></label>
          <label>What to do, one per line <textarea data-list="todo" data-l="${l}" rows="3" placeholder="Return to the store, refund">${esc((it.todo?.[l] ?? []).join("\n"))}</textarea></label>
        </details>`).join("")}
      <div class="weekend-acts">
        ${it.status === "confirmed"
          ? `<button class="primary" data-act="confirmed">Save changes</button><button class="ghost" data-act="new">Take off the site</button>`
          : `<button class="primary" data-act="confirmed">Confirm</button><button class="ghost" data-act="dropped">Drop</button>`}
      </div>
    </li>`).join("");
}

async function decide(li, status) {
  const body = { etag, id: li.dataset.id, status, product: {}, reason: {}, line: {}, check: {}, todo: {} };
  li.querySelectorAll("[data-t]").forEach((input) => { body[input.dataset.t][input.dataset.l] = input.value; });
  li.querySelectorAll("[data-list]").forEach((input) => { body[input.dataset.list][input.dataset.l] = input.value.split("\n"); });
  li.querySelectorAll("[data-k]").forEach((input) => { body[input.dataset.k] = input.value; });
  body.stores = body.stores.split(",");
  note("Saving…");
  try {
    const res = await fetch("/api/recalls", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
  const btn = ev.target.closest?.("#recalls [data-act]");
  if (btn) decide(btn.closest("li"), btn.dataset.act);
});

load();
