// Rednote box: this weekend's picture set per town and the hand-written sets (St. Martin …), drawn by
// the site's build. Save the pictures, copy title and caption, post by hand. Talks to /api/rednote.
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let sets = [];

async function load() {
  try {
    const res = await fetch("/api/rednote");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    sets = body.sets.map((s) => ({ ...s, pictures: s.pictures.map((p) => body.site + p) }));
    note("");
  } catch (error) {
    note(`Could not load the Rednote cards: ${error.message}`, true);
  }
  render();
}

function note(text, error = false) {
  $("rednote-banner").hidden = !text;
  $("rednote-banner").classList.toggle("error", error);
  $("rednote-banner").textContent = text;
}

function render() {
  const box = $("rednote");
  if (!sets.length) {
    box.innerHTML = `<p class="sub">No cards yet. They are drawn when the weekend edition is published on Friday.</p>`;
    return;
  }
  box.innerHTML = sets.map((s, i) => `
    <section class="rednote-set">
      <h3>${esc(s.kind === "weekly" ? `${s.town}, weekend of ${s.weekend}` : s.id)}</h3>
      <div class="rednote-pics">
        ${s.pictures.map((p, n) => `<a href="${esc(p)}" target="_blank" rel="noopener"><img src="${esc(p)}" alt="Card ${n + 1}" loading="lazy" width="135" height="180"></a>`).join("")}
      </div>
      <label for="rn-title-${i}">Title</label>
      <div class="rednote-copy">
        <input id="rn-title-${i}" readonly value="${esc(s.title)}">
        <button class="ghost" data-copy="rn-title-${i}">Copy</button>
      </div>
      <label for="rn-caption-${i}">Caption</label>
      <div class="rednote-copy">
        <textarea id="rn-caption-${i}" readonly rows="8">${esc(s.caption)}</textarea>
        <button class="ghost" data-copy="rn-caption-${i}">Copy</button>
      </div>
    </section>`).join("");
}

document.addEventListener("click", async (ev) => {
  const btn = ev.target.closest?.("[data-copy]");
  if (!btn || !btn.closest("#rednote")) return;
  const field = $(btn.dataset.copy);
  try {
    await navigator.clipboard.writeText(field.value);
    btn.textContent = "Copied";
    setTimeout(() => { btn.textContent = "Copy"; }, 1500);
  } catch {
    field.select();
  }
});

load();
