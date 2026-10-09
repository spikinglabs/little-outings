import { test } from "node:test";
import assert from "node:assert/strict";
import { KEYS, MOVE_MAX, SYNC_KEY, clean, forget, merge, packForMove, readProfile, rememberSent, unpackMove, writeProfile } from "../src/lib/profile.ts";
import { onRequest, webauthn, HOURLY_LIMIT } from "../functions/api/profile/[[path]].ts";
import { fakeD1 } from "./fake-d1.ts";
import { onRequestPost as tap } from "../functions/api/taps.ts";

function memStore() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

test("clean keeps only what a profile may hold", () => {
  const p = clean({ saved: ["cafe-a", "cafe-a", "<script>", 5], went: "x", asked: { "a:fac:toys": "yes", b: "maybe" }, home: "Haan", voter: "short", evil: 1,
    sent: [{ kind: "tip", at: "2026-10-09T00:00:00Z", data: { text: "hi" } }, { kind: "tip" }] });
  assert.deepEqual(p, { app: "little-outings", v: 1, saved: ["cafe-a"], went: [], asked: { "a:fac:toys": "yes" }, home: "Haan",
    sent: [{ kind: "tip", at: "2026-10-09T00:00:00Z", data: { text: "hi" } }] });
});

test("merge joins lists, keeps this phone's answers and home, adopts the other voter id", () => {
  const mine = clean({ saved: ["a"], went: ["x"], asked: { q1: "yes" }, home: "Haan", voter: "local-voter-1" });
  const other = clean({ saved: ["b", "a"], went: ["y"], asked: { q1: "no", q2: "no" }, home: "Velbert", voter: "synced-voter-1" });
  const m = merge(mine, other);
  assert.deepEqual(m.saved.sort(), ["a", "b"]);
  assert.deepEqual(m.went.sort(), ["x", "y"]);
  assert.deepEqual(m.asked, { q1: "yes", q2: "no" });
  assert.equal(m.home, "Haan");
  assert.equal(m.voter, "synced-voter-1");
  assert.deepEqual(merge(m, m), m);
});

test("the profile reads from and writes to the browser's storage; forget removes it all", () => {
  const s = memStore();
  s.setItem(KEYS.saved, '["a"]');
  s.setItem(KEYS.voter, "voter-12345");
  s.setItem(SYNC_KEY, '{"token":"t"}');
  s.setItem("lo-map", "1");
  rememberSent(s, { kind: "answer", gap: "cafe-a:fac:toys", answer: "yes", lang: "de" }, new Date("2026-10-09T10:00:00Z"));
  const p = readProfile(s);
  assert.deepEqual(p.saved, ["a"]);
  assert.deepEqual(p.sent, [{ kind: "answer", item: "cafe-a", at: "2026-10-09T10:00:00.000Z", data: { kind: "answer", gap: "cafe-a:fac:toys", answer: "yes" } }]);
  const s2 = memStore();
  writeProfile(s2, p);
  assert.deepEqual(readProfile(s2), p);
  forget(s);
  assert.deepEqual([...s.m.keys()], ["lo-map"]);
});

test("a profile survives the trip through a move link", async () => {
  const p = clean({ saved: ["a", "b"], went: ["c"], asked: { "a:fac:toys": "yes" }, home: "Haan", voter: "voter-12345" });
  const { code, full } = await packForMove(p);
  assert.ok(full);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(await unpackMove(code), p);
  assert.equal(await unpackMove("not-a-profile"), null);
});

test("a move link too long for a QR code leaves the chip answers out", async () => {
  const asked = Object.fromEntries(Array.from({ length: 900 }, (_, i) => [`place-${i * 7919}:fac:${["toys", "playground", "toilets"][i % 3]}`, ["yes", "no"][i % 2]]));
  const { code, full } = await packForMove(clean({ saved: ["a"], asked }));
  assert.equal(full, false);
  assert.ok(code.length <= MOVE_MAX);
  assert.deepEqual((await unpackMove(code))!.asked, {});
});

/* ---------- /api/profile ---------- */

const call = (env: any, method: string, path: string, body?: unknown, token?: string) => onRequest({
  env, params: { path: path.split("/") },
  request: new Request(`https://outings.example/api/profile/${path}`, {
    method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "cf-connecting-ip": "1.2.3.4", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  }),
});

// Real passkeys need a phone; the signature check is swapped for one that accepts a known credential.
webauthn.verifyRegistrationResponse = (async ({ response, expectedOrigin, expectedRPID }: any) => {
  assert.equal(expectedOrigin, "https://outings.example");
  assert.equal(expectedRPID, "outings.example");
  return response.ok
    ? { verified: true, registrationInfo: { credential: { id: response.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] } } }
    : { verified: false };
}) as any;
webauthn.verifyAuthenticationResponse = (async ({ response, credential }: any) => {
  assert.deepEqual([...credential.publicKey], [1, 2, 3]);
  return response.ok ? { verified: true, authenticationInfo: { newCounter: 1 } } : { verified: false };
}) as any;

test("without a database passkey sync answers 503", async () => {
  assert.equal((await call({}, "POST", "register-options", {})).status, 503);
});

test("passkey sync: create, save, sign in on another phone, delete", async () => {
  const env = { DB: fakeD1() };
  const start = await (await call(env, "POST", "register-options", {})).json();
  assert.equal(start.options.rp.id, "outings.example");
  assert.equal(start.options.user.name, "Little Outings");
  const reg = await call(env, "POST", "register", { challenge: start.challenge, response: { id: "cred-1", ok: true }, profile: { saved: ["a"] } });
  assert.equal(reg.status, 200);
  const { token } = await reg.json();
  // A challenge works once.
  assert.equal((await call(env, "POST", "register", { challenge: start.challenge, response: { id: "cred-2", ok: true }, profile: {} })).status, 400);

  assert.equal((await call(env, "PUT", "data", { profile: { saved: ["a", "b"] } }, token)).status, 200);
  assert.deepEqual((await (await call(env, "GET", "data", undefined, token)).json()).profile, { saved: ["a", "b"] });
  assert.equal((await call(env, "GET", "data", undefined, "f".repeat(64))).status, 401);
  assert.equal((await call(env, "GET", "data")).status, 401);
  assert.equal((await call(env, "PUT", "data", { profile: { big: "x".repeat(300_000) } }, token)).status, 413);

  // The second phone.
  const ls = await (await call(env, "POST", "login-options", {})).json();
  assert.equal((await call(env, "POST", "login", { challenge: ls.challenge, response: { id: "cred-1", ok: false } })).status, 400);
  const ls2 = await (await call(env, "POST", "login-options", {})).json();
  const login = await call(env, "POST", "login", { challenge: ls2.challenge, response: { id: "cred-1", ok: true } });
  assert.equal(login.status, 200);
  const second = await login.json();
  assert.deepEqual(second.profile, { saved: ["a", "b"] });

  // Signing out ends that phone's session only.
  assert.equal((await call(env, "POST", "logout", {}, second.token)).status, 200);
  assert.equal((await call(env, "GET", "data", undefined, second.token)).status, 401);
  assert.equal((await call(env, "GET", "data", undefined, token)).status, 200);

  // Deleting removes the profile, the passkey and every session.
  assert.equal((await call(env, "DELETE", "data", undefined, token)).status, 200);
  assert.equal((await call(env, "GET", "data", undefined, token)).status, 401);
  const ls3 = await (await call(env, "POST", "login-options", {})).json();
  assert.equal((await call(env, "POST", "login", { challenge: ls3.challenge, response: { id: "cred-1", ok: true } })).status, 404);
});

test("a challenge made for signing in can't create a passkey", async () => {
  const env = { DB: fakeD1() };
  const ls = await (await call(env, "POST", "login-options", {})).json();
  assert.equal((await call(env, "POST", "register", { challenge: ls.challenge, response: { id: "c", ok: true }, profile: {} })).status, 400);
});

test("one connection can start only so many passkey ceremonies an hour", async () => {
  const env = { DB: fakeD1() };
  for (let i = 0; i < HOURLY_LIMIT; i++) assert.equal((await call(env, "POST", "login-options", {})).status, 200);
  assert.equal((await call(env, "POST", "login-options", {})).status, 429);
});

test("signing in on a browser that already tapped moves its taps to the synced id", async () => {
  const env = { DB: fakeD1() };
  const start = await (await call(env, "POST", "register-options", {})).json();
  await call(env, "POST", "register", { challenge: start.challenge, response: { id: "cred-1", ok: true }, profile: { voter: "synced-voter" } });
  await tap({ env, request: new Request("https://x/api/taps", { method: "POST", body: JSON.stringify({ kind: "fac", item: "cafe-a", feature: "toys", answer: "yes", voter: "local-voter" }) }) });
  const ls = await (await call(env, "POST", "login-options", {})).json();
  assert.equal((await call(env, "POST", "login", { challenge: ls.challenge, response: { id: "cred-1", ok: true }, voter: "local-voter" })).status, 200);
  const mine = async (voter: string) => (await tap({ env, request: new Request("https://x/api/taps?mine=1", { method: "POST", body: JSON.stringify({ voter }) }) })).json();
  assert.equal((await mine("synced-voter")).length, 1);
  assert.equal((await mine("local-voter")).length, 0);
});
