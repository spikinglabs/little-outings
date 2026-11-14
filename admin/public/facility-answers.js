// Facility answers panel: what parents tapped on place pages ("Is there parking?"). Read only:
// votes decide by themselves (more yes than no), so this is for seeing and checking them.
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
const FEATURE = {
  playground: "Playground", changing_table: "Changing table", highchairs: "High chairs", kids_menu: "Kids' menu",
  toys: "Toys & little gifts", animals: "Animals", stroller_friendly: "Pram-friendly", nursing_room: "Nursing corner",
  indoor_play: "Indoor play area", toilets: "Toilets", farm_shop: "Farm shop", parking: "Parking", sandpit: "Sandpit",
  water_play: "Water play", swings: "Swings", slides: "Slides", climbing: "Climbing", toddler_area: "Toddler area",
  shade: "Shade", benches: "Benches", fenced: "Fenced in", birthday: "Birthday parties",
};
const SAYS = { yes: "Yes", no: "No", unknown: "Undecided" };

function pageNote(r) {
  if (r.live === r.onPage) return `<span class="badge">On the page</span>`;
  if (r.onPage !== "unknown" && r.live === "unknown") return `<span class="badge">Page keeps ${esc(SAYS[r.onPage].toLowerCase())} (from the source)</span>`;
  return `<span class="badge out">After tonight's rebuild</span>`;
}

function rowHtml(r) {
  const place = `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.name || r.item)}</a>${r.town ? ` <span class="sub">${esc(r.town)}</span>` : ""}`;
  const counts = [`${r.yes} yes`, `${r.no} no`, r.unsure ? `${r.unsure} not sure` : ""].filter(Boolean).join(" · ");
  return `<tr>
    <td>${place}</td>
    <td>${esc(FEATURE[r.feature] || r.feature)}</td>
    <td>${esc(counts)}</td>
    <td><b>${esc(SAYS[r.live])}</b> ${pageNote(r)}</td>
    <td class="sub">${esc(dateFmt.format(new Date(r.last)))}</td>
  </tr>`;
}

async function load() {
  const banner = $("facans-banner");
  try {
    const res = await fetch("/api/facility-answers?days=30");
    const body = await res.json().catch(() => ({}));
    if (body.error) { banner.hidden = false; banner.classList.add("error"); banner.textContent = body.error; }
    const rows = body.rows || [];
    const places = new Set(rows.map((r) => r.item)).size;
    $("facans-count").textContent = rows.length ? `${places} place${places === 1 ? "" : "s"}` : "";
    $("facans").innerHTML = rows.length
      ? `<div class="usage-wrap"><table class="usage facans"><thead><tr><th>Place</th><th>Question</th><th>Answers</th><th>Parents say</th><th>Last answer</th></tr></thead>
         <tbody>${rows.map(rowHtml).join("")}</tbody></table></div>`
      : (body.error ? "" : '<p class="sub">No facility answers in the last 30 days.</p>');
  } catch (error) {
    banner.hidden = false;
    banner.classList.add("error");
    banner.textContent = `Could not load facility answers: ${error.message}`;
  }
}

load();
