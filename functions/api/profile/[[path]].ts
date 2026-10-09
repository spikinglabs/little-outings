// Cloudflare Pages Function: /api/profile/*
// Optional passkey sync for a family's profile (see src/lib/profile.ts). There is no account: a
// passkey is created with no name or email, and it unlocks one row holding the profile JSON. Phones
// sync passkeys themselves (iCloud Keychain, Google Password Manager), so signing in on a second
// phone brings the profile along. Nothing here can recover a lost passkey; the copy on the phone and
// the downloaded file are the backup.
//
//   POST   /api/profile/register-options                → passkey creation options + challenge id
//   POST   /api/profile/register  { challenge, response, profile }  → { token }
//   POST   /api/profile/login-options                   → passkey request options + challenge id
//   POST   /api/profile/login     { challenge, response, voter? }   → { token, profile }
//          (voter: this browser's own id; its earlier taps move to the synced profile's id)
//   GET    /api/profile/data      Authorization: Bearer <token>     → { profile, updated }
//   PUT    /api/profile/data      Authorization: Bearer <token>  { profile }
//   DELETE /api/profile/data      Authorization: Bearer <token>     removes the profile, its passkeys and sessions
//   POST   /api/profile/logout    Authorization: Bearer <token>     ends this device's session
//
// Environment: DB, the same D1 binding as /api/taps (tables are created on first use);
// TAP_SALT is reused for hashing IPs for the hourly limit. Without DB it answers 503.

import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { moveTaps, type D1 } from "../taps.ts";

interface Env { DB?: D1; TAP_SALT?: string }
type Ctx = { request: Request; env: Env; params: { path?: string[] } };

/** The WebAuthn library, swappable in tests (a real passkey can't be made in Node). */
export const webauthn = { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse };

/** Largest profile we keep (a full one is well under 100 KB). */
export const MAX_PROFILE = 200_000;
/** Passkey ceremonies one connection may start per hour. */
export const HOURLY_LIMIT = 30;
const CHALLENGE_TTL = 10 * 60_000;
const SESSION_TTL = 400 * 24 * 3600_000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const ready = new WeakSet<D1>();
async function schema(db: D1) {
  if (ready.has(db)) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS profiles (user TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS profile_keys (id TEXT PRIMARY KEY, user TEXT NOT NULL, public_key TEXT NOT NULL,
      counter INTEGER NOT NULL, transports TEXT, at INTEGER NOT NULL)`),
    // Earlier copies of each profile, so one overwritten by mistake can be put back.
    db.prepare(`CREATE TABLE IF NOT EXISTS profile_versions (user TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS profile_versions_user ON profile_versions (user, updated)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS profile_sessions (token TEXT PRIMARY KEY, user TEXT NOT NULL, at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS profile_challenges (id TEXT PRIMARY KEY, challenge TEXT NOT NULL, kind TEXT NOT NULL,
      user TEXT, ip TEXT NOT NULL, at INTEGER NOT NULL)`),
  ]);
  ready.add(db);
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
async function sha(s: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
}
const random = (n = 32) => hex(crypto.getRandomValues(new Uint8Array(n)));
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function readBody(request: Request): Promise<any> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_PROFILE + 20_000) throw new Error("too large");
  const text = await request.text();
  if (text.length > MAX_PROFILE + 20_000) throw new Error("too large");
  return JSON.parse(text || "{}");
}

/** The profile as stored: any JSON object under the size limit. The browser cleans it on the way in. */
function profileText(p: unknown): string | null {
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const s = JSON.stringify(p);
  return s.length <= MAX_PROFILE ? s : null;
}

/**
 * Copies of a profile kept per family. One is kept per hour of changes, so a burst of edits doesn't
 * push the old ones out, and always one before the profile shrinks (something removed or wiped).
 */
export const VERSIONS = 20;
const size = (data: string) => {
  try { const p = JSON.parse(data); return [p.saved, p.went, p.sent].reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0) + Object.keys(p.asked ?? {}).length; } catch { return 0; }
};
async function keepVersion(db: D1, user: string, next: string) {
  const cur = await db.prepare(`SELECT data, updated FROM profiles WHERE user = ?`).bind(user).first<{ data: string; updated: number }>();
  if (!cur || cur.data === next) return;
  const last = await db.prepare(`SELECT MAX(updated) AS at FROM profile_versions WHERE user = ?`).bind(user).first<{ at: number | null }>();
  if (size(next) >= size(cur.data) && last?.at != null && cur.updated - last.at < 3600_000) return;
  await db.batch([
    db.prepare(`INSERT INTO profile_versions (user, data, updated) VALUES (?, ?, ?)`).bind(user, cur.data, cur.updated),
    db.prepare(`DELETE FROM profile_versions WHERE user = ? AND updated NOT IN
      (SELECT updated FROM profile_versions WHERE user = ? ORDER BY updated DESC LIMIT ?)`).bind(user, user, VERSIONS),
  ]);
}

async function newSession(db: D1, user: string, now: number) {
  const token = random();
  await db.prepare(`INSERT INTO profile_sessions (token, user, at) VALUES (?, ?, ?)`).bind(await sha(token), user, now).run();
  return token;
}

async function sessionUser(db: D1, request: Request, now: number): Promise<{ user: string; token: string } | null> {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get("authorization") ?? "");
  if (!m) return null;
  const token = await sha(m[1]);
  const row = await db.prepare(`SELECT user, at FROM profile_sessions WHERE token = ?`).bind(token).first<{ user: string; at: number }>();
  if (!row || now - row.at > SESSION_TTL) return null;
  // Used sessions stay alive; a phone left alone for over a year signs in again.
  if (now - row.at > 24 * 3600_000) await db.prepare(`UPDATE profile_sessions SET at = ? WHERE token = ?`).bind(now, token).run();
  return { user: row.user, token };
}

async function startChallenge(db: D1, env: Env, request: Request, kind: "register" | "login", challenge: string, user: string | null, now: number) {
  const ip = await sha(`${env.TAP_SALT ?? "little-outings"}:${request.headers.get("cf-connecting-ip") ?? ""}`);
  await db.prepare(`DELETE FROM profile_challenges WHERE at < ?`).bind(now - CHALLENGE_TTL).run();
  const recent = await db.prepare(`SELECT COUNT(*) AS n FROM profile_challenges WHERE ip = ? AND at > ?`).bind(ip, now - 3600_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= HOURLY_LIMIT) return null;
  const id = random(16);
  await db.prepare(`INSERT INTO profile_challenges (id, challenge, kind, user, ip, at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, challenge, kind, user, ip, now).run();
  return id;
}

/** A challenge can be used once, by the ceremony it was made for, within ten minutes. */
async function takeChallenge(db: D1, id: unknown, kind: string, now: number) {
  if (typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id)) return null;
  const row = await db.prepare(`SELECT challenge, kind, user, at FROM profile_challenges WHERE id = ?`).bind(id)
    .first<{ challenge: string; kind: string; user: string | null; at: number }>();
  await db.prepare(`DELETE FROM profile_challenges WHERE id = ?`).bind(id).run();
  if (!row || row.kind !== kind || now - row.at > CHALLENGE_TTL) return null;
  return row;
}

export async function onRequest({ request, env, params }: Ctx): Promise<Response> {
  if (!env.DB) return json(503, { error: "profile sync not configured" });
  const db = env.DB;
  await schema(db);
  const route = (params.path ?? []).join("/");
  const url = new URL(request.url);
  const rpID = url.hostname;
  const origin = url.origin;
  const now = Date.now();
  const method = request.method;

  let body: any = {};
  if (method === "POST" || method === "PUT") {
    try { body = await readBody(request); } catch (e) { return json((e as Error).message === "too large" ? 413 : 400, { error: (e as Error).message }); }
  }

  if (route === "register-options" && method === "POST") {
    const user = random(16);
    const options = await webauthn.generateRegistrationOptions({
      rpName: "Little Outings", rpID, userID: new TextEncoder().encode(user),
      // Shown in the phone's passkey list. Deliberately not a person's name; the date tells two apart.
      userName: `Little Outings ${new Date(now).toISOString().slice(0, 10)}`, userDisplayName: `Little Outings ${new Date(now).toISOString().slice(0, 10)}`,
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });
    const challenge = await startChallenge(db, env, request, "register", options.challenge, user, now);
    if (!challenge) return json(429, { error: "slow down" });
    return json(200, { challenge, options });
  }

  if (route === "register" && method === "POST") {
    const c = await takeChallenge(db, body.challenge, "register", now);
    if (!c || !c.user) return json(400, { error: "challenge expired" });
    const data = profileText(body.profile);
    if (!data) return json(400, { error: "invalid profile" });
    let v;
    try {
      v = await webauthn.verifyRegistrationResponse({ response: body.response, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false });
    } catch { return json(400, { error: "passkey not accepted" }); }
    if (!v.verified) return json(400, { error: "passkey not accepted" });
    const cred = v.registrationInfo.credential;
    await db.batch([
      db.prepare(`INSERT INTO profile_keys (id, user, public_key, counter, transports, at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(cred.id, c.user, b64url(cred.publicKey), cred.counter, JSON.stringify(cred.transports ?? []), now),
      db.prepare(`INSERT INTO profiles (user, data, updated) VALUES (?, ?, ?)`).bind(c.user, data, now),
    ]);
    return json(200, { token: await newSession(db, c.user, now), updated: now });
  }

  if (route === "login-options" && method === "POST") {
    // No allowCredentials: the phone offers whichever Little Outings passkey it has.
    const options = await webauthn.generateAuthenticationOptions({ rpID, userVerification: "preferred" });
    const challenge = await startChallenge(db, env, request, "login", options.challenge, null, now);
    if (!challenge) return json(429, { error: "slow down" });
    return json(200, { challenge, options });
  }

  if (route === "login" && method === "POST") {
    const c = await takeChallenge(db, body.challenge, "login", now);
    if (!c) return json(400, { error: "challenge expired" });
    const id = body.response?.id;
    if (typeof id !== "string" || id.length > 1400) return json(400, { error: "passkey not accepted" });
    const key = await db.prepare(`SELECT id, user, public_key, counter, transports FROM profile_keys WHERE id = ?`).bind(id)
      .first<{ id: string; user: string; public_key: string; counter: number; transports: string | null }>();
    // A passkey whose profile was deleted: the phone still offers it, but there is nothing behind it.
    if (!key) return json(404, { error: "no profile for this passkey" });
    let v;
    try {
      v = await webauthn.verifyAuthenticationResponse({
        response: body.response, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
        credential: { id: key.id, publicKey: unb64url(key.public_key), counter: key.counter, transports: JSON.parse(key.transports || "[]") },
      });
    } catch { return json(400, { error: "passkey not accepted" }); }
    if (!v.verified) return json(400, { error: "passkey not accepted" });
    await db.prepare(`UPDATE profile_keys SET counter = ? WHERE id = ?`).bind(v.authenticationInfo.newCounter, key.id).run();
    const row = await db.prepare(`SELECT data, updated FROM profiles WHERE user = ?`).bind(key.user).first<{ data: string; updated: number }>();
    const profile = row ? JSON.parse(row.data) : null;
    // The browser will take on the synced voter id; bring the taps it made before signing in along.
    if (typeof body.voter === "string" && typeof profile?.voter === "string") await moveTaps(db, body.voter, profile.voter);
    return json(200, { token: await newSession(db, key.user, now), profile, updated: row?.updated ?? null });
  }

  const session = await sessionUser(db, request, now);
  if (!session) return json(401, { error: "sign in again" });

  if (route === "data" && method === "GET") {
    const row = await db.prepare(`SELECT data, updated FROM profiles WHERE user = ?`).bind(session.user).first<{ data: string; updated: number }>();
    return json(200, { profile: row ? JSON.parse(row.data) : null, updated: row?.updated ?? null });
  }
  if (route === "data" && method === "PUT") {
    const data = profileText(body.profile);
    if (!data) return json(400, { error: "invalid profile" });
    await keepVersion(db, session.user, data);
    await db.prepare(`INSERT INTO profiles (user, data, updated) VALUES (?, ?, ?)
      ON CONFLICT (user) DO UPDATE SET data = excluded.data, updated = excluded.updated`).bind(session.user, data, now).run();
    return json(200, { ok: true, updated: now });
  }
  if (route === "data" && method === "DELETE") {
    await db.batch([
      db.prepare(`DELETE FROM profiles WHERE user = ?`).bind(session.user),
      db.prepare(`DELETE FROM profile_versions WHERE user = ?`).bind(session.user),
      db.prepare(`DELETE FROM profile_keys WHERE user = ?`).bind(session.user),
      db.prepare(`DELETE FROM profile_sessions WHERE user = ?`).bind(session.user),
    ]);
    return json(200, { ok: true });
  }
  if (route === "logout" && method === "POST") {
    await db.prepare(`DELETE FROM profile_sessions WHERE token = ?`).bind(session.token).run();
    return json(200, { ok: true });
  }
  return json(404, { error: "not found" });
}
