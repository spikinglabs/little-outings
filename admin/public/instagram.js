// Instagram box: the week's carousel (cover, a card per town, closing card) with its English caption,
// drawn by the site's build (src/lib/instagram.ts). Nothing posts until you press Approve; then the
// posting job (scripts/post-instagram.mjs, hourly on Friday and Saturday daytime) publishes it to the
// account whose token is saved below. You can still save the pictures and post by hand instead.
import { cardBox } from "./cards.js";
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const when = (iso) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

let state = { approvals: {}, posted: {}, token: { connected: false } };

function status(s) {
  const posted = state.posted[s.id], ok = state.approvals[s.id];
  if (posted) return `<p class="ig-status ok">Posted ${esc(when(posted.at))}${posted.permalink ? ` · <a href="${esc(posted.permalink)}" target="_blank" rel="noopener">open on Instagram</a>` : ""}</p>`;
  if (ok) return `<p class="ig-status">Approved by ${esc(ok.by)}, ${esc(when(ok.at))}. ${state.token.connected ? "Posts at the next half hour (Fri and Sat, 7:30 to 19:30)." : "It posts once the account is connected below."}
    <button class="ghost" data-ig="unapprove" data-id="${esc(s.id)}">Take back</button></p>`;
  return `<p class="ig-status"><button class="primary" data-ig="approve" data-id="${esc(s.id)}">Approve for posting</button>
    <span class="sub">Check the cards and caption first; nothing posts without this.</span></p>`;
}

function renderToken() {
  const t = state.token;
  $("instagram-token").innerHTML = `
    <p class="sub">${t.connected
      ? `Connected as @${esc(t.username ?? "?")}. The token is renewed every Friday; it runs out in ${t.days_left} days if the posting job stops.`
      : t.expires_at ? "The token ran out. Generate a new one in the Meta app and paste it here." : "Not connected yet. In the Meta app: Instagram → API setup with Instagram login → Generate token for the account, then paste it here."}</p>
    <div class="rednote-copy">
      <input id="ig-token" type="password" autocomplete="off" placeholder="Paste a new access token">
      <button class="ghost" data-ig="token">Save token</button>
    </div>`;
}

const box = cardBox({
  id: "instagram", label: "Instagram", type: "image/jpeg", size: [144, 180], title: false,
  onLoad: (body) => { state = { approvals: body.approvals ?? {}, posted: body.posted ?? {}, token: body.token ?? { connected: false } }; renderToken(); },
  decorate: status,
});

document.addEventListener("click", async (ev) => {
  const btn = ev.target.closest?.("#instagram-panel [data-ig]");
  if (!btn) return;
  const action = btn.dataset.ig;
  const body = action === "token" ? { action, token: $("ig-token").value } : { action, id: btn.dataset.id };
  btn.disabled = true;
  try {
    const res = await fetch("/api/instagram", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
    state = out;
    box.note(action === "token" ? `Saved. Connected as @${out.token.username ?? "?"}.` : "");
    renderToken();
    box.render();
  } catch (error) {
    box.note(error.message, true);
  } finally {
    btn.disabled = false;
  }
});
