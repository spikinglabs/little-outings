// Passkey sync, when a family turned it on: changes on this phone are sent to /api/profile/data a
// moment later, and the synced copy is brought in now and then, so a second phone catches up.
// Without a passkey nothing here runs and the profile stays on this device.
import { SYNC_KEY, merge, readProfile, writeProfile, clean } from "../lib/profile";

type Sync = { token: string; pulled?: number; pushed?: number };
const PULL_EVERY = 3600_000;

export function getSync(): Sync | null {
  try { const s = JSON.parse(localStorage.getItem(SYNC_KEY) || "null"); return s?.token ? s : null; } catch { return null; }
}
export function setSync(s: Sync | null) {
  try { s ? localStorage.setItem(SYNC_KEY, JSON.stringify(s)) : localStorage.removeItem(SYNC_KEY); } catch { /* storage blocked */ }
  document.dispatchEvent(new CustomEvent("lo:sync"));
}

const auth = (s: Sync) => ({ authorization: `Bearer ${s.token}`, "content-type": "application/json" });
/** The server forgot this session (deleted elsewhere, or a year unused): sync turns off, the local copy stays. */
function dropIf401(res: Response) { if (res.status === 401) setSync(null); return res.ok; }

let timer: ReturnType<typeof setTimeout> | undefined;
export function schedulePush() {
  if (!getSync()) return;
  clearTimeout(timer);
  timer = setTimeout(() => { timer = undefined; push(); }, 1500);
}
export async function push(keepalive = false): Promise<boolean> {
  const s = getSync();
  if (!s) return false;
  try {
    const res = await fetch("/api/profile/data", { method: "PUT", headers: auth(s), keepalive, body: JSON.stringify({ profile: readProfile(localStorage) }) });
    if (dropIf401(res)) setSync({ ...s, pushed: Date.now() });
    return res.ok;
  } catch { return false; }
}
// Leaving the page before the timer fired: send it anyway.
if (typeof window !== "undefined") addEventListener("pagehide", () => { if (timer) { clearTimeout(timer); timer = undefined; push(true); } });

/** Brings the synced copy into this phone's profile. Returns true when something new arrived. */
export async function pull(): Promise<boolean> {
  const s = getSync();
  if (!s) return false;
  try {
    const res = await fetch("/api/profile/data", { headers: auth(s) });
    if (!dropIf401(res)) return false;
    const { profile } = await res.json() as { profile: unknown };
    setSync({ ...getSync()!, pulled: Date.now() });
    return adopt(profile);
  } catch { return false; }
}

/** Merges another copy into this phone's profile; sends the result back when the two differed. */
export function adopt(other: unknown): boolean {
  const mine = readProfile(localStorage);
  const merged = merge(mine, clean(other));
  const changed = JSON.stringify(merged) !== JSON.stringify(mine);
  if (changed) {
    try { writeProfile(localStorage, merged); } catch { return false; }
    document.dispatchEvent(new CustomEvent("lo:profile"));
  }
  if (JSON.stringify(merged) !== JSON.stringify(clean(other))) schedulePush();
  return changed;
}

export function pullNowAndThen() {
  const s = getSync();
  if (s && Date.now() - (s.pulled ?? 0) > PULL_EVERY) pull();
}
