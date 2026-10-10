// Signing in with the family's passkey (the one behind "Profile & sync"), from any page that needs it:
// Profile itself, and meetups, where making one or answering one needs it.
// "login" uses a passkey the phone already has; "register" makes a new one and syncs this phone's profile.
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { readProfile } from "../lib/profile";
import { adopt, getSync, setSync } from "./sync";

/** ok, the parent cancelled, the passkey has no profile behind it, the server has no database, or it failed. */
export type PasskeyResult = "ok" | "cancel" | "unknown" | "soon" | "fail";

export const passkeysWork = () => browserSupportsWebAuthn();
export const signedIn = () => !!getSync();

const post = (path: string, body: unknown = {}) =>
  fetch(`/api/profile/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const local = () => readProfile(localStorage);

export async function register(): Promise<PasskeyResult> {
  try {
    const start = await post("register-options");
    if (start.status === 503 || start.status === 404) return "soon";
    if (!start.ok) return "fail";
    const { challenge, options } = await start.json();
    const response = await startRegistration({ optionsJSON: options });
    const res = await post("register", { challenge, response, profile: local() });
    if (!res.ok) return "fail";
    const { token, updated } = await res.json();
    setSync({ token, pushed: updated, pulled: updated });
    return "ok";
  } catch (e) {
    return (e as Error).name === "NotAllowedError" ? "cancel" : "fail"; // NotAllowedError: the parent cancelled
  }
}

/** Signing in merges the passkey's copy into this phone's profile, so nothing on this phone is dropped. */
export async function login(): Promise<PasskeyResult> {
  try {
    const start = await post("login-options");
    if (start.status === 503 || start.status === 404) return "soon";
    if (!start.ok) return "fail";
    const { challenge, options } = await start.json();
    const response = await startAuthentication({ optionsJSON: options });
    const res = await post("login", { challenge, response, voter: local().voter });
    if (res.status === 404) return "unknown";
    if (!res.ok) return "fail";
    const { token, profile, updated } = await res.json();
    setSync({ token, pulled: updated ?? Date.now() });
    adopt(profile);
    return "ok";
  } catch (e) {
    return (e as Error).name === "NotAllowedError" ? "cancel" : "fail";
  }
}

/** Headers for a call that needs the passkey session. */
export function authHeaders(): Record<string, string> {
  const s = getSync();
  return { "content-type": "application/json", ...(s ? { authorization: `Bearer ${s.token}` } : {}) };
}
