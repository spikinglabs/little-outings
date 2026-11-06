// Instagram posting, the admin's side: Approve (or take back) a set the site's build drew, and save the
// account's access token. The posting job (scripts/post-instagram.mjs) publishes approved sets and renews
// the token. Plain logic, no bucket or network, so tests run it.

export const GRAPH = "https://graph.instagram.com";
const DAY = 864e5;

/** approvals: { "<set id>": { by, at } }. body: { action: "approve" | "unapprove", id }. */
export function applyApproval(approvals, body, user, sets, now = new Date()) {
  const next = { ...(approvals ?? {}) };
  const id = String(body?.id ?? "");
  if (body?.action === "approve") {
    if (!sets.some((s) => s.id === id)) throw new Error("That set isn't drawn on the site (any more). Reload.");
    next[id] = { by: user?.email ?? "admin", at: now.toISOString() };
  } else if (body?.action === "unapprove") {
    delete next[id];
  } else throw new Error("Unknown action.");
  // Keep two months of history; older sets are long gone from the site.
  for (const [k, v] of Object.entries(next)) if (now - Date.parse(v.at) > 60 * DAY) delete next[k];
  return next;
}

/** What the panel may know about the token: never the token itself. */
export function tokenInfo(file, now = new Date()) {
  if (!file?.token) return { connected: false };
  const days = Math.floor((Date.parse(file.expires_at) - now) / DAY);
  return { connected: days >= 0, username: file.username ?? null, expires_at: file.expires_at, days_left: days };
}

/** A token as pasted: one line of letters, digits and a few signs, nothing else. */
export function cleanToken(raw) {
  const token = String(raw ?? "").trim();
  if (!/^[A-Za-z0-9_\-.|]{40,1024}$/.test(token)) throw new Error("That doesn't look like an Instagram access token. Copy it again from the Meta app (Instagram → API setup → Generate token).");
  return token;
}

/**
 * Checks a pasted token with Instagram and returns what the bucket keeps. The dashboard's "Generate token"
 * gives a long-lived token (60 days); the job renews it weekly.
 */
export async function tokenFile(raw, fetcher = fetch, now = new Date()) {
  const token = cleanToken(raw);
  const res = await fetcher(`${GRAPH}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`);
  const me = await res.json().catch(() => ({}));
  if (!res.ok || !me.user_id) throw new Error(`Instagram refused the token: ${me.error?.message ?? res.status}`);
  return {
    token, user_id: String(me.user_id), username: me.username ?? null,
    saved_at: now.toISOString(), refreshed_at: now.toISOString(),
    expires_at: new Date(+now + 60 * DAY).toISOString(),
  };
}
