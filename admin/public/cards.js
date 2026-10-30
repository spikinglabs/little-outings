// A box of picture sets drawn by the site's build, posted by hand: the Rednote box (rednote.js) and the
// Instagram box (instagram.js). Save the pictures, copy title and caption. Talks to /api/<id>.
// "Save all" hands a phone every card of a set at once (its share menu: Photos, Files or the app itself);
// a computer, or a phone that can't share files, gets them as one ZIP.
import { zipStore } from "./zip.js";
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * id: "rednote" or "instagram" (the box #<id>, its banner #<id>-banner, the API /api/<id>); label: the
 * app's name in messages; type: the cards' picture type; size: a thumbnail's [width, height]; title: show
 * the set's title as a field to copy (Rednote notes have one, Instagram posts don't).
 */
export function cardBox({ id, label, type, size, title }) {
  let sets = [];

  async function load() {
    try {
      const res = await fetch(`/api/${id}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      sets = body.sets.map((s) => ({ ...s, paths: s.pictures, pictures: s.pictures.map((p) => body.site + p) }));
      note("");
    } catch (error) {
      note(`Could not load the ${label} cards: ${error.message}`, true);
    }
    render();
  }

  function note(text, error = false) {
    $(`${id}-banner`).hidden = !text;
    $(`${id}-banner`).classList.toggle("error", error);
    $(`${id}-banner`).textContent = text;
  }

  function render() {
    const box = $(id);
    if (!sets.length) {
      box.innerHTML = `<p class="sub">No cards yet. They are drawn when the weekend edition is published on Friday.</p>`;
      return;
    }
    box.innerHTML = sets.map((s, i) => `
      <section class="rednote-set">
        <h3>${esc(s.kind === "weekly" ? `${s.town}, weekend of ${s.weekend}` : s.kind === "alert" ? `⚠ City alert: ${s.town}, ${s.day}` : s.kind === "set" ? s.id : s.title)}</h3>
        <div class="rednote-pics">
          ${s.pictures.map((p, n) => `<a href="${esc(p)}" target="_blank" rel="noopener"><img src="${esc(p)}" alt="Card ${n + 1}" loading="lazy" width="${size[0]}" height="${size[1]}"></a>`).join("")}
        </div>
        <div class="rednote-save">
          <button class="primary" data-save="${i}">Save all ${s.pictures.length} pictures</button>
          <button class="ghost" data-zip="${i}">Download ZIP</button>
        </div>
        ${title ? `<label for="${id}-title-${i}">Title</label>
        <div class="rednote-copy">
          <input id="${id}-title-${i}" readonly value="${esc(s.title)}">
          <button class="ghost" data-copy="${id}-title-${i}">Copy</button>
        </div>` : ""}
        <label for="${id}-caption-${i}">Caption</label>
        <div class="rednote-copy">
          <textarea id="${id}-caption-${i}" readonly rows="8">${esc(s.caption)}</textarea>
          <button class="ghost" data-copy="${id}-caption-${i}">Copy</button>
        </div>
      </section>`).join("");
    watch();
  }

  // ---------- save all ----------

  const files = new Map();
  /** A set's cards as File objects, fetched once. "koeln-2026-10-31-1.png" … in posting order. */
  function filesOf(i) {
    if (!files.has(i)) {
      files.set(i, Promise.all(sets[i].paths.map(async (path) => {
        const res = await fetch(`/api/${id}?pic=${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error(`Card ${path} could not be loaded (${res.status})`);
        return new File([await res.blob()], path.split("/").pop(), { type });
      })));
      files.get(i).catch(() => files.delete(i));
    }
    return files.get(i);
  }

  // Fetch a set's cards when its buttons come into view: a phone's share menu only opens straight
  // from a tap, and a tap that waits on eight downloads first may be refused.
  let seen;
  function watch() {
    seen?.disconnect();
    if (!("IntersectionObserver" in window)) return;
    seen = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { filesOf(Number(e.target.dataset.save)).catch(() => {}); seen.unobserve(e.target); }
    }, { rootMargin: "300px" });
    document.querySelectorAll(`#${id} [data-save]`).forEach((b) => seen.observe(b));
  }

  const canShareFiles = (list) => !!(navigator.canShare && navigator.canShare({ files: list }));

  async function saveAll(i, btn, zip) {
    btn.disabled = true;
    try {
      const list = await filesOf(i);
      if (!zip && canShareFiles(list)) {
        // The caption goes to the clipboard on the way, ready to paste into the note.
        await navigator.clipboard?.writeText(sets[i].caption).catch(() => {});
        await navigator.share({ files: list }).catch((e) => { if (e.name !== "AbortError") throw e; });
        return;
      }
      const bytes = zipStore(await Promise.all(list.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      a.download = `${sets[i].id}.zip`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (error) {
      note(`Could not save the pictures: ${error.message}`, true);
    } finally {
      btn.disabled = false;
    }
  }

  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest?.(`#${id} [data-save], #${id} [data-zip]`);
    if (btn) saveAll(Number(btn.dataset.save ?? btn.dataset.zip), btn, "zip" in btn.dataset);
  });

  document.addEventListener("click", async (ev) => {
    const btn = ev.target.closest?.("[data-copy]");
    if (!btn || !btn.closest(`#${id}`)) return;
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
}
