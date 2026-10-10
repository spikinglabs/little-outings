import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { onRequest, readMeetup, DAILY_LIMIT, forgetMeetups } from "../functions/api/meetups/[[path]].ts";
import { pickLang, previewText } from "../functions/m/[id].ts";
import { isEvening, stampOf, whenText, whereText } from "../src/lib/meetup.ts";
import { matchPlaces } from "../src/lib/where.ts";
import { fakeD1 } from "./fake-d1.ts";

const NOW = Date.parse("2026-10-10T10:00:00Z");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** A database with two signed-in families, "a" and "b". */
async function setup() {
  const db = fakeD1();
  await db.prepare(`CREATE TABLE profile_sessions (token TEXT PRIMARY KEY, user TEXT NOT NULL, at INTEGER NOT NULL)`).run();
  const tokens: Record<string, string> = {};
  for (const u of ["a", "b"]) {
    tokens[u] = u.repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, u === "a" ? "a" : "b");
    await db.prepare(`INSERT INTO profile_sessions VALUES (?, ?, ?)`).bind(sha(tokens[u]), `user-${u}`, Date.now()).run();
  }
  const call = async (method: string, path: string, body?: unknown, who?: "a" | "b") => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (who) headers.authorization = `Bearer ${tokens[who]}`;
    const res = await onRequest({ env: { DB: db }, params: { path: path ? path.split("/") : [] },
      request: new Request(`https://outings.allo.land/api/meetups/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }) });
    return { status: res.status, body: await res.json() as any };
  };
  return { db, call };
}

const soon = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
const picnic = { title: "Picnic", date: soon, time: "14:00", place: "Rheinpark", town: "Köln", lang: "en", note: "Bring a blanket" };

test("making an invite needs the passkey; the organiser counts as going", async () => {
  const { call } = await setup();
  assert.equal((await call("POST", "", picnic)).status, 401);
  const made = await call("POST", "", picnic, "a");
  assert.equal(made.status, 200);
  assert.match(made.body.id, /^[a-z2-9]{10}$/);
  const seen = await call("GET", made.body.id);
  assert.equal(seen.body.meetup.title, "Picnic");
  assert.equal(seen.body.meetup.mine, false, "a visitor without a passkey isn't the organiser");
  assert.equal(seen.body.meetup.owner, undefined, "who made it never leaves the server");
  assert.deepEqual(seen.body.counts, { going: 1, maybe: 0, no: 0 });
  assert.equal((await call("GET", made.body.id, undefined, "a")).body.meetup.mine, true);
});

test("a family answers, changes its mind and takes the answer back", async () => {
  const { call } = await setup();
  const { id } = (await call("POST", "", picnic, "a")).body;
  assert.equal((await call("PUT", `${id}/answer`, { answer: "going" })).status, 401);
  assert.deepEqual((await call("PUT", `${id}/answer`, { answer: "maybe" }, "b")).body.counts, { going: 1, maybe: 1, no: 0 });
  assert.deepEqual((await call("PUT", `${id}/answer`, { answer: "going" }, "b")).body.counts, { going: 2, maybe: 0, no: 0 });
  assert.equal((await call("GET", id, undefined, "b")).body.answer, "going");
  assert.deepEqual((await call("PUT", `${id}/answer`, { answer: null }, "b")).body.counts, { going: 1, maybe: 0, no: 0 });
  assert.equal((await call("PUT", `${id}/answer`, { answer: "sure" }, "b")).status, 400);
  const mine = (await call("GET", "mine", undefined, "b")).body.meetups;
  assert.equal(mine.length, 0, "an answer taken back drops the invite from Mine");
});

test("only the organiser can change, call off or delete an invite", async () => {
  const { call } = await setup();
  const { id } = (await call("POST", "", picnic, "a")).body;
  assert.equal((await call("PUT", id, { ...picnic, title: "Hijacked" }, "b")).status, 404);
  assert.equal((await call("DELETE", id, undefined, "b")).status, 404);
  assert.equal((await call("PUT", id, { ...picnic, title: "Picnic and kites" }, "a")).body.meetup.title, "Picnic and kites");
  assert.equal((await call("PUT", id, { cancelled: true }, "a")).body.meetup.cancelled, true);
  assert.equal((await call("PUT", `${id}/answer`, { answer: "going" }, "b")).status, 409, "no new answers once it's off");
  assert.equal((await call("PUT", id, { cancelled: false }, "a")).body.meetup.cancelled, false);
  assert.equal((await call("DELETE", id, undefined, "a")).status, 200);
  assert.equal((await call("GET", id)).status, 404);
});

test("Mine lists invites made and answered, with counts", async () => {
  const { call } = await setup();
  const { id } = (await call("POST", "", picnic, "a")).body;
  await call("PUT", `${id}/answer`, { answer: "maybe" }, "b");
  const a = (await call("GET", "mine", undefined, "a")).body.meetups;
  const b = (await call("GET", "mine", undefined, "b")).body.meetups;
  assert.equal(a[0].mine, true);
  assert.deepEqual(a[0].counts, { going: 1, maybe: 1 });
  assert.equal(b[0].mine, false);
  assert.equal(b[0].answer, "maybe");
});

test("a family can start only so many invites a day", async () => {
  const { call } = await setup();
  for (let i = 0; i < DAILY_LIMIT; i++) assert.equal((await call("POST", "", picnic, "a")).status, 200);
  assert.equal((await call("POST", "", picnic, "a")).status, 429);
  assert.equal((await call("POST", "", picnic, "b")).status, 200);
});

test("deleting a profile removes its invites and answers", async () => {
  const { db, call } = await setup();
  const { id } = (await call("POST", "", picnic, "a")).body;
  const other = (await call("POST", "", picnic, "b")).body.id;
  await call("PUT", `${other}/answer`, { answer: "going" }, "a");
  await forgetMeetups(db, "user-a");
  assert.equal((await call("GET", id)).status, 404);
  assert.deepEqual((await call("GET", other)).body.counts, { going: 1, maybe: 0, no: 0 });
});

test("what a parent types is cleaned, and the date must be near", () => {
  assert.deepEqual(readMeetup({ ...picnic, title: "  " }, NOW), { error: "title" });
  assert.deepEqual(readMeetup({ ...picnic, place: "" }, NOW), { error: "place" });
  assert.deepEqual(readMeetup({ ...picnic, date: "2026-10-01" }, NOW), { error: "date" });
  assert.deepEqual(readMeetup({ ...picnic, date: "2028-01-01" }, NOW), { error: "date" });
  const m = readMeetup({ ...picnic, date: "2026-10-18", time: "25:00", lat: 50.9, lang: "xx", placeId: "<b>" }, NOW) as any;
  assert.equal(m.time, null);
  assert.equal(m.lat, null, "a latitude without a longitude is dropped");
  assert.equal(m.lang, "de");
  assert.equal(m.placeId, null);
});

test("the link preview names the invite, its day and place", () => {
  const m = { title: "Picnic", date: "2026-10-17", time: "14:00", place: "Rheinpark", town: "Köln", cancelled: 0 };
  assert.deepEqual(previewText(m, "en"), { title: "Picnic · Sat 17 Oct, 14:00", description: "Rheinpark, Köln. Tap “We’re going” to join." });
  assert.match(previewText({ ...m, cancelled: 1 }, "de").title, /^Abgesagt\. Picnic · Sa\.?,? 17\. Okt/);
  const url = new URL("https://outings.allo.land/m/abc");
  assert.equal(pickLang(url, "zh-CN,zh;q=0.9", "de"), "zh");
  assert.equal(pickLang(url, "fr-FR", "en"), "en");
  assert.equal(pickLang(new URL("https://x/m/a?lang=de"), "zh", "en"), "de");
});

test("evening invites are flagged; dates read naturally", () => {
  assert.equal(isEvening("18:00"), true);
  assert.equal(isEvening("17:59"), false);
  assert.equal(isEvening(""), false);
  assert.equal(whenText({ date: "2026-10-17", time: "14:00" }, "en-GB"), "Saturday 17 October, 14:00");
  assert.deepEqual(stampOf("2026-10-17", "de-DE"), { dow: "Sa", day: "17", mon: "Okt" });
  assert.equal(whereText({ place: "Rheinpark, Köln", town: "Köln" }), "Rheinpark, Köln");
});

test("Where? finds places by the start of their name first", () => {
  const pin = (title: string, sub = "Park · Köln") => ({ id: title, type: "place" as const, title, sub, href: "", lat: 0, lon: 0, precision: "exact" as const });
  const all = [pin("Spielplatz Rheinpark", "Spielplatz · Köln"), pin("Rheinpark"), pin("Düren Zoo", "Zoo · Düren")];
  assert.deepEqual(matchPlaces(all, "rhein").map((p) => p.title), ["Rheinpark", "Spielplatz Rheinpark"]);
  assert.deepEqual(matchPlaces(all, "dueren").map((p) => p.title), ["Düren Zoo"]);
  assert.deepEqual(matchPlaces(all, "r"), []);
});
