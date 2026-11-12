// Posts box: Rednote topic posts (Christmas markets, toy votes, St. Martin …), each with a four-character
// code. Claude writes them in posts/ of the site repository and the posts job draws them here within minutes
// of a push, without a site deploy (.github/workflows/posts.yml). Type a code, or tap one of the current
// posts, to open it: "Post" hands its pictures to the phone's share menu (pick 小红书) and copies the title,
// then the caption; the Copy buttons copy either again. ?post=<code> in the address opens one straight away.
import { cardBox } from "./cards.js";
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
const clean = (v) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);

let open = clean(new URLSearchParams(location.search).get("post"));

const box = cardBox({
  id: "posts", label: "post", type: "image/png", size: [135, 180], title: true,
  visible: (s) => s.code === open,
  empty: "",
  saveLabel: (n) => `Post (${n} pictures)`,
  onLoad: () => queueMicrotask(list),
});

/** The current posts (not past their `until` day) as buttons, newest first; past ones open by code only. */
function list() {
  const sets = box.sets();
  const current = sets.filter((s) => !s.until || s.until >= today());
  $("posts-list").innerHTML = current.length
    ? current.map((s) => `<button class="${s.code === open ? "primary" : "ghost"}" data-post="${esc(s.code)}">${esc(s.code)} · ${esc(s.title)}</button>`).join("")
    : `<p class="sub">No current posts.</p>`;
  const found = sets.find((s) => s.code === open);
  $("posts-found").textContent = !open ? "" : found ? (found.until && found.until < today() ? `Listed until ${found.until}, still here by its code.` : "") : open.length === 4 ? `No post ${open}. It shows a few minutes after Claude pushes it.` : "";
  box.render();
}

function show(code) {
  open = clean(code);
  $("posts-code").value = open;
  const url = new URL(location.href);
  if (open) url.searchParams.set("post", open); else url.searchParams.delete("post");
  history.replaceState(null, "", url);
  list();
}

$("posts-code").value = open;
$("posts-code").addEventListener("input", (ev) => show(ev.target.value));
document.addEventListener("click", (ev) => {
  const btn = ev.target.closest?.("#posts-panel [data-post]");
  if (btn) show(btn.dataset.post === open ? "" : btn.dataset.post);
});
