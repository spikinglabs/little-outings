// Inbox panel: what parents wrote, waiting for a yes or no. Talks to /api/inbox.
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });

const KIND = { tip: "Tip", report: "Report", "new-event": "New event", "new-place": "New place", answer: "Answer" };
const GAP = { hours: "Opening hours", time: "Time", price: "Price", where: "Where exactly", still: "Still on?" };
const BUTTON = { approve: "Approve", done: "Done, fixed", reject: "Reject" };
const TOPIC = { bring: "Bring", bestTime: "Best time", parking: "Parking", ages: "Best for ages", other: "Other" };
const REASON = {
  closed: "It's closed or gone", cancelled: "It's cancelled", where: "It's in a different place",
  notKids: "It's not for children", outdated: "Something is out of date", other: "Something else",
};

let items = [];

async function load() {
  try {
    const res = await fetch("/api/inbox");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    items = body.items;
    note("");
  } catch (error) {
    items = [];
    note(`Could not load the inbox: ${error.message}`, true);
  }
  render();
}

function note(text, error = false) {
  $("inbox-banner").hidden = !text;
  $("inbox-banner").classList.toggle("error", error);
  $("inbox-banner").textContent = text;
}

const field = (label, value) => (value ? `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : "");

function details(item) {
  const d = item.data;
  if (item.kind === "tip") return `<p class="said">“${esc(d.text)}”</p><dl>${field("About", TOPIC[d.topic] || d.topic)}</dl>`;
  if (item.kind === "answer") return `<p class="said">“${esc(d.answer)}”</p><dl>${field("Question", GAP[d.gap] || d.gap)}</dl>${agreeNote(item)}`;
  if (item.kind === "report") return `<p class="said">${esc(REASON[d.reason] || d.reason)}</p>${d.note ? `<p>“${esc(d.note)}”</p>` : ""}`;
  if (item.kind === "new-event") {
    return `<p class="said">${esc(d.title)}</p><dl>${field("Date", d.date)}${field("Time", d.time)}${field("Place", d.place)}${
      field("Price", d.price)}${field("Note", d.note)}</dl>`;
  }
  return `<p class="said">${esc(d.name)}</p><dl>${field("Type", d.type)}${field("Town", d.town)}${field("Street", d.street)}${
    field("Website", d.website)}${field("Has", (d.features || []).join(", "))}${field("Note", d.note)}</dl>`;
}

/** Why an answer waits: nobody else answered yet, or parents said different things. */
function agreeNote(item) {
  const a = item.agreement;
  if (!a) return item.actions.includes("approve") ? "" : '<p class="sub">Fix it on the site by hand, then mark it done.</p>';
  if (a.status === "single") return '<p class="sub">Only answer so far. It goes live when a second parent says the same, or when you approve it.</p>';
  const all = a.options.map((o) => `“${esc(o.value)}” (${o.count})`).join(", ");
  return `<p class="sub">Parents disagree: ${all}. Approving one puts it on the page.</p>`;
}

function itemHtml(item) {
  const about = item.data.item
    ? item.page
      ? `<a href="${esc(item.page.url)}" target="_blank" rel="noopener noreferrer">${esc(item.page.name)}</a>`
      : `<span>${esc(item.data.item)} <small class="sub">(not on the site any more)</small></span>`
    : "";
  return `<li class="inbox-item">
    <div class="inbox-body">
      <div class="meta">
        <span class="badge edited">${esc(KIND[item.kind])}</span>
        ${about}
        <span class="sub">${esc(dateFmt.format(new Date(item.created_at)))}${item.data.lang ? ` · ${esc(item.data.lang)}` : ""}</span>
        <a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">#${item.number}</a>
      </div>
      ${details(item)}
    </div>
    <div class="event-actions">
      ${item.actions.map((a) =>
        `<button type="button" class="${a === "reject" ? "ghost" : "primary"}" data-inbox="${a}" data-number="${item.number}">${BUTTON[a]}</button>`).join("")}
    </div>
  </li>`;
}

function render() {
  $("inbox-count").textContent = items.length ? `${items.length} waiting` : "";
  $("inbox").innerHTML = items.map(itemHtml).join("")
    || ($("inbox-banner").hidden ? '<li class="sub">Nothing waiting. New tips, reports, suggestions and answers show up here.</li>' : "");
}

async function decide(button) {
  const number = Number(button.dataset.number);
  const action = button.dataset.inbox;
  const buttons = button.parentElement.querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));
  try {
    const res = await fetch("/api/inbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ number, action }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 409) throw new Error(body.error || `Request failed (${res.status})`);
    items = items.filter((i) => i.number !== number);
    note("");
    render();
  } catch (error) {
    buttons.forEach((b) => (b.disabled = false));
    note(`Could not ${action} #${number}: ${error.message}`, true);
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-inbox]");
  if (button) decide(button);
});

load();
