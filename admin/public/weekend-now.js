// The Rednote panel's "Make sets for <next weekend> now" button. It publishes the coming weekend's edition
// at once instead of on Friday (the "Weekend edition now" workflow, through /api/weekend-now); the site
// build that follows draws the Rednote and Instagram cards. Towns already out for that weekend stay as they are.
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const timeFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** The coming weekend's Saturday and Sunday, counted in Germany (on a Sunday: the weekend under way). */
export function comingWeekend(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(now);
  const d = new Date(`${today}T12:00:00Z`);
  const dow = d.getUTCDay();
  const sat = new Date(d.getTime() + (dow === 0 ? -1 : 6 - dow) * 864e5);
  const sun = new Date(sat.getTime() + 864e5);
  const label = sat.getUTCMonth() === sun.getUTCMonth() ? `${sat.getUTCDate()}–${dayFmt.format(sun)}` : `${dayFmt.format(sat)}–${dayFmt.format(sun)}`;
  return { sat: sat.toISOString().slice(0, 10), label };
}

let timer, wasRunning = false;

function show(run, error) {
  const btn = $("weekend-now-btn"), note = $("weekend-now-note");
  const running = run && run.status !== "completed";
  btn.disabled = !!running;
  btn.textContent = running ? "Making them…" : `Make sets for ${comingWeekend().label} now`;
  if (error) note.innerHTML = `<span class="error-text">${esc(error)}</span>`;
  else if (running) note.textContent = `Started ${timeFmt.format(new Date(run.started))}. Takes about 10 minutes, then the site build draws the cards.`;
  else if (run && wasRunning && run.conclusion === "success") note.textContent = "Done. The site is drawing the cards now: reload this page in about 5 minutes.";
  else if (run && run.conclusion === "success") note.textContent = `Last made ${timeFmt.format(new Date(run.started))}.`;
  else if (run) note.innerHTML = `The last try (${esc(timeFmt.format(new Date(run.started)))}) didn't finish: <a href="${esc(run.url)}" target="_blank" rel="noopener">see what went wrong</a>.`;
  else note.textContent = "";
  wasRunning = !!running;
  clearTimeout(timer);
  if (running) timer = setTimeout(refresh, 20000);
}

async function refresh() {
  try {
    const res = await fetch("/api/weekend-now");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    show(body.run);
  } catch (error) {
    show(null, error.message);
  }
}

async function start() {
  const { label } = comingWeekend();
  if (!confirm(`Publish the weekend edition for ${label} now, for every town?\n\nIt goes on the weekend pages too. Thursday and Friday won't change it afterwards, so the codes on the cards stay right.`)) return;
  $("weekend-now-btn").disabled = true;
  try {
    const res = await fetch("/api/weekend-now", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    // GitHub lists the new run a few seconds after it is asked for.
    show({ status: "queued", started: new Date().toISOString() });
  } catch (error) {
    show(null, error.message);
  }
}

if (typeof document !== "undefined" && $("weekend-now-btn")) {
  $("weekend-now-btn").textContent = `Make sets for ${comingWeekend().label} now`;
  $("weekend-now-btn").addEventListener("click", start);
  refresh();
}
