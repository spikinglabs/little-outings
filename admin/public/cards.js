// A box of picture sets, posted by hand: the Rednote box (rednote.js) and the Instagram box (instagram.js),
// drawn by the site's build, and the Posts box (posts.js), drawn by the posts job. Save the pictures, copy
// title and caption. Talks to /api/<id>.
// "Save all" hands a phone every card of a set at once (its share menu: Photos, Files or the app itself);
// a computer, or a phone that can't share files, gets them as one ZIP. On the way it copies the title and
// then the caption, so both wait in the keyboard's clipboard list (Gboard, Samsung, SwiftKey keep the
// last few) and a plain paste gives the caption: no coming back to copy them.
import { zipStore } from "./zip.js";
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * id: "rednote" or "instagram" (the box #<id>, its banner #<id>-banner, the API /api/<id>); label: the
 * app's name in messages; type: the cards' picture type; size: a thumbnail's [width, height]; title: show
 * the set's title as a field to copy (Rednote notes have one, Instagram posts don't). Optional: onLoad(body)
 * gets the API's whole answer, decorate(set) adds HTML under a set's heading, visible(set) picks the sets
 * shown (default all), empty is the text when none is, saveLabel(n) names the main button.
 * Returns { load, render, note, sets }.
 */
export function cardBox({ id, label, type, size, title, onLoad, decorate, visible, empty, saveLabel }) {
  let sets = [];

  async function load() {
    try {
      const res = await fetch(`/api/${id}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      sets = body.sets.map((s) => ({ ...s, paths: s.pictures, pictures: s.pictures.map((p) => body.site + p) }));
      onLoad?.(body);
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
    const shown = sets.map((s, i) => [s, i]).filter(([s]) => !visible || visible(s));
    if (!shown.length) {
      box.innerHTML = `<p class="sub">${esc(empty ?? "No cards yet. They are drawn when the weekend edition is published early on Monday.")}</p>`;
      return;
    }
    box.innerHTML = shown.map(([s, i]) => `
      <section class="rednote-set">
        <h3>${esc(s.kind === "weekly" ? `${s.town}, weekend of ${s.weekend}` : s.kind === "alert" ? `⚠ City alert: ${s.town}, ${s.day}` : s.kind === "post" ? `${s.code} · ${s.title}` : s.title)}</h3>
        ${decorate ? decorate(s) : ""}
        <div class="rednote-pics">
          ${s.pictures.map((p, n) => `<a href="${esc(p)}" target="_blank" rel="noopener"><img src="${esc(p)}" alt="Card ${n + 1}" loading="lazy" width="${size[0]}" height="${size[1]}"></a>`).join("")}
        </div>
        <div class="rednote-save">
          <button class="primary" data-save="${i}">${esc(saveLabel ? saveLabel(s.pictures.length) : `Save all ${s.pictures.length} pictures`)}</button>
          <button class="ghost" data-zip="${i}">Download ZIP</button>
        </div>
        <p class="sub rednote-hint" id="${id}-hint-${i}">${title
          ? `${saveLabel ? "Post" : "Save all"} also copies the title, then the caption. In the app: paste into the text, and pick the title from your keyboard's clipboard.`
          : `${saveLabel ? "Post" : "Save all"} also copies the caption: paste it into the post.`}</p>
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
        await copyTexts(i);
        await navigator.share({ files: list }).catch((e) => {
          if (e.name === "AbortError") return;
          // A browser that lets a tap's permission run out while copying: the cards are loaded now, so a second tap is quick.
          if (e.name === "NotAllowedError") throw new Error("the phone did not open its share menu, tap Save all again");
          throw e;
        });
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

  /**
   * Title first, then the caption, a moment apart so the keyboard records each as its own clip; the
   * caption comes last, so a plain paste gives the long text and the title is one tap in the clip list.
   */
  async function copyTexts(i) {
    const hint = $(`${id}-hint-${i}`);
    try {
      if (title && sets[i].title) {
        await navigator.clipboard.writeText(sets[i].title);
        await new Promise((r) => setTimeout(r, 350));
      }
      await navigator.clipboard.writeText(sets[i].caption);
      if (hint) hint.textContent = title ? "Copied the title and the caption ✓ Paste the caption; the title is in your keyboard's clipboard." : "Copied the caption ✓";
    } catch {
      if (hint) hint.textContent = "Could not copy the texts: use the Copy buttons below.";
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
  return { load, render, note, sets: () => sets };
}
