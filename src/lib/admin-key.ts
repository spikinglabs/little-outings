// The admin site's shared secret (MEETUP_ADMIN_KEY on both Pages projects), sent as header x-admin-key.
// Used by /api/meetups (remove a reported invite) and /api/parse (the poster reader's log).

const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

/** The admin's key, compared as hashes so the time taken says nothing about how much matched. */
export async function isAdmin(request: Request, env: { MEETUP_ADMIN_KEY?: string }) {
  const given = request.headers.get("x-admin-key");
  if (!env.MEETUP_ADMIN_KEY || env.MEETUP_ADMIN_KEY.length < 32 || !given) return false;
  const [a, b] = await Promise.all([digest(given), digest(env.MEETUP_ADMIN_KEY)]);
  return a.reduce((diff, x, i) => diff | (x ^ b[i]), 0) === 0;
}
