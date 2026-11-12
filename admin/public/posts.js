// Posts box: Rednote topic posts (Christmas markets, toy votes, St. Martin …), each with a four-character
// code. Claude writes them in posts/ of the site repository and the posts job draws them here within minutes
// of a push, without a site deploy (.github/workflows/posts.yml). One search box finds a post by its code,
// a word of its title or a date (the day it was made or its last day, e.g. 11-12 or 2026-12): an exact code
// opens it, anything else lists up to MAX matches to tap. With the box empty only the newest few show, so the
// panel stays short however many posts there are. "Post" hands the pictures to the phone's share menu (pick
// 小红书) and copies the title, then the caption; the Copy buttons copy either again. ?post=<code> opens one.
import { cardBox } from "./cards.js";
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const MAX = 8, NEWEST = 3;
const code = (v) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const made = (s) => String(s.updated ?? "").slice(0, 10);

let open = code(new URLSearchParams(location.search).get("post")).slice(0, 4);
let query = open;

const box = cardBox({
  id: "posts", label: "post", type: "image/png", size: [135, 180], title: true,
  visible: (s) => s.code === open,
  empty: "",
  saveLabel: (n) => `Post (${n} pictures)`,
  onLoad: () => queueMicrotask(list),
});

/** Posts whose code, title or dates contain every word typed, newest first (the API's order). */
function search(sets, q) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return sets.filter((s) => {
    const hay = `${s.code} ${s.title} ${made(s)} ${s.until ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

function list() {
  const sets = box.sets();
  const q = query.trim();
  // An exact code opens its post straight away.
  const exact = sets.find((s) => s.code === code(q) && code(q).length === 4);
  if (exact) open = exact.code;
  const hits = q ? search(sets, q) : sets.slice(0, NEWEST);
  $("posts-list").innerHTML = (q ? "" : `<p class="sub">Newest:</p>`) + (hits.length
    ? hits.slice(0, MAX).map((s) => `<button class="${s.code === open ? "primary" : "ghost"}" data-post="${esc(s.code)}">${esc(s.code)} · ${esc(s.title)} <span class="sub">${esc(made(s))}</span></button>`).join("")
    : q ? `<p class="sub">No post matches “${esc(q)}”. A new one shows a few minutes after Claude pushes it.</p>` : `<p class="sub">No posts yet.</p>`);
  $("posts-found").textContent = hits.length > MAX ? `${hits.length} matches, showing ${MAX}: type more to narrow.` : "";
  box.render();
}

function show(c) {
  open = c;
  const url = new URL(location.href);
  if (open) url.searchParams.set("post", open); else url.searchParams.delete("post");
  history.replaceState(null, "", url);
  list();
}

$("posts-q").value = query;
$("posts-q").addEventListener("input", (ev) => { query = ev.target.value; list(); });
document.addEventListener("click", (ev) => {
  const btn = ev.target.closest?.("#posts-panel [data-post]");
  if (btn) show(btn.dataset.post === open ? "" : btn.dataset.post);
});
