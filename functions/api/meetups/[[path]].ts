// Cloudflare Pages Function: /api/meetups/*
// Meetups a parent plans themselves (a picnic, a playground date) and shares by link. They are never
// listed: only people with the link find one. Making one and answering one both need the passkey from
// "Profile & sync" (no name or email), so the organiser can always change or call off their meetup, and
// a family can change its answer from any phone. Visitors without a passkey can still read the page.
//
//   POST   /api/meetups              { title, date, time?, place, town?, placeId?, lat?, lon?, note?, lang }  → { id }
//   GET    /api/meetups/mine         the meetups this family made and answered, with counts
//   GET    /api/meetups/<id>         one meetup, its counts, and (signed in) this family's answer
//   PUT    /api/meetups/<id>         organiser: change it, or { cancelled: true|false }
//   DELETE /api/meetups/<id>         organiser: remove it with all answers
//   PUT    /api/meetups/<id>/answer  { answer: going|maybe|no|null }
//
// Every call that changes something needs Authorization: Bearer <profile session token>.
// Environment: DB, the same D1 binding as /api/profile (tables are created on first use). Without DB it answers 503.

import type { D1 } from "../taps.ts";
import { sessionUser } from "../profile/[[path]].ts";

interface Env { DB?: D1 }
type Ctx = { request: Request; env: Env; params: { path?: string[] } };

/** Meetups one family may start per day. */
export const DAILY_LIMIT = 10;
/** Past meetups are removed this long after their day. */
const KEEP_DAYS = 60;
export const ANSWERS = ["going", "maybe", "no"] as const;
export type Answer = (typeof ANSWERS)[number];

const ID = /^[a-z2-9]{10}$/;
// No 0/1/l/o: a link read aloud or typed off a screen still works.
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export function newId() {
  const b = crypto.getRandomValues(new Uint8Array(10));
  return [...b].map((x) => ALPHABET[x % ALPHABET.length]).join("");
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const ready = new WeakSet<D1>();
export async function schema(db: D1) {
  if (ready.has(db)) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS meetups (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL,
      time TEXT, place TEXT NOT NULL, town TEXT, place_id TEXT, lat REAL, lon REAL, note TEXT, lang TEXT NOT NULL,
      cancelled INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS meetups_owner ON meetups (owner, created)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS meetup_answers (meetup TEXT NOT NULL, user TEXT NOT NULL, answer TEXT NOT NULL, at INTEGER NOT NULL,
      PRIMARY KEY (meetup, user))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS meetup_answers_user ON meetup_answers (user)`),
  ]);
  ready.add(db);
}

/** Removes everything a family made or answered (from "Delete my data"). */
export async function forgetMeetups(db: D1, user: string) {
  await schema(db);
  await db.batch([
    db.prepare(`DELETE FROM meetup_answers WHERE meetup IN (SELECT id FROM meetups WHERE owner = ?)`).bind(user),
    db.prepare(`DELETE FROM meetups WHERE owner = ?`).bind(user),
    db.prepare(`DELETE FROM meetup_answers WHERE user = ?`).bind(user),
  ]);
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const today = (now: number) => new Date(now).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export interface MeetupInput { title: string; date: string; time: string | null; place: string; town: string | null;
  placeId: string | null; lat: number | null; lon: number | null; note: string | null; lang: string }

/** What a parent typed, cleaned; or the first thing that's wrong with it. */
export function readMeetup(b: any, now: number): MeetupInput | { error: string } {
  const title = str(b?.title, 100);
  const place = str(b?.place, 160);
  const date = typeof b?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && !Number.isNaN(Date.parse(b.date)) ? b.date : "";
  if (!title) return { error: "title" };
  if (!place) return { error: "place" };
  // Yesterday is allowed so a phone a few hours behind (or a late edit) isn't refused.
  if (!date || date < addDays(today(now), -1) || date > addDays(today(now), 366)) return { error: "date" };
  const time = typeof b?.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.time) ? b.time : null;
  const lat = typeof b?.lat === "number" && Math.abs(b.lat) <= 90 ? b.lat : null;
  const lon = typeof b?.lon === "number" && Math.abs(b.lon) <= 180 ? b.lon : null;
  const placeId = typeof b?.placeId === "string" && /^[a-z0-9-]{1,100}$/.test(b.placeId) ? b.placeId : null;
  const note = typeof b?.note === "string" ? b.note.trim().slice(0, 500) || null : null;
  return { title, date, time, place, town: str(b?.town, 60) || null, placeId, lat: lat != null && lon != null ? lat : null,
    lon: lat != null && lon != null ? lon : null, note, lang: ["de", "en", "zh"].includes(b?.lang) ? b.lang : "de" };
}

type Row = { id: string; owner: string; title: string; date: string; time: string | null; place: string; town: string | null;
  place_id: string | null; lat: number | null; lon: number | null; note: string | null; lang: string; cancelled: number; updated: number };

/** A meetup as the page shows it. The owner stays on the server; `mine` says whether the reader is it. */
export function publicMeetup(r: Row, user: string | null) {
  return { id: r.id, title: r.title, date: r.date, time: r.time, place: r.place, town: r.town, placeId: r.place_id,
    lat: r.lat, lon: r.lon, note: r.note, lang: r.lang, cancelled: !!r.cancelled, updated: r.updated, mine: !!user && r.owner === user };
}

export async function getMeetup(db: D1, id: string): Promise<Row | null> {
  if (!ID.test(id)) return null;
  await schema(db);
  return db.prepare(`SELECT * FROM meetups WHERE id = ?`).bind(id).first<Row>();
}

async function counts(db: D1, id: string) {
  const { results } = await db.prepare(`SELECT answer, COUNT(*) AS n FROM meetup_answers WHERE meetup = ? GROUP BY answer`).bind(id)
    .all<{ answer: string; n: number }>();
  const c = { going: 0, maybe: 0, no: 0 };
  for (const r of results) if (r.answer in c) c[r.answer as Answer] = r.n;
  return c;
}

export async function onRequest({ request, env, params }: Ctx): Promise<Response> {
  if (!env.DB) return json(503, { error: "meetups not configured" });
  const db = env.DB;
  await schema(db);
  const [first = "", second = ""] = params.path ?? [];
  const method = request.method;
  const now = Date.now();
  const session = await sessionUser(db, request, now);
  const user = session?.user ?? null;
  let body: any = {};
  if (method === "POST" || method === "PUT") {
    if (Number(request.headers.get("content-length") ?? 0) > 8000) return json(413, { error: "too large" });
    try { body = JSON.parse((await request.text()) || "{}"); } catch { return json(400, { error: "invalid json" }); }
  }

  // Start a meetup.
  if (!first && method === "POST") {
    if (!user) return json(401, { error: "sign in" });
    const m = readMeetup(body, now);
    if ("error" in m) return json(400, m);
    const recent = await db.prepare(`SELECT COUNT(*) AS n FROM meetups WHERE owner = ? AND created > ?`).bind(user, now - 864e5).first<{ n: number }>();
    if ((recent?.n ?? 0) >= DAILY_LIMIT) return json(429, { error: "slow down" });
    // Tidy up: meetups long past go, with their answers.
    const old = addDays(today(now), -KEEP_DAYS);
    await db.batch([
      db.prepare(`DELETE FROM meetup_answers WHERE meetup IN (SELECT id FROM meetups WHERE date < ?)`).bind(old),
      db.prepare(`DELETE FROM meetups WHERE date < ?`).bind(old),
    ]);
    const id = newId();
    await db.prepare(`INSERT INTO meetups (id, owner, title, date, time, place, town, place_id, lat, lon, note, lang, cancelled, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .bind(id, user, m.title, m.date, m.time, m.place, m.town, m.placeId, m.lat, m.lon, m.note, m.lang, now, now).run();
    // The organiser is going, of course.
    await db.prepare(`INSERT INTO meetup_answers (meetup, user, answer, at) VALUES (?, ?, 'going', ?)`).bind(id, user, now).run();
    return json(200, { id });
  }

  if (first === "mine" && method === "GET") {
    if (!user) return json(401, { error: "sign in" });
    const { results } = await db.prepare(`SELECT m.*, a.answer AS my_answer,
        (SELECT COUNT(*) FROM meetup_answers g WHERE g.meetup = m.id AND g.answer = 'going') AS going,
        (SELECT COUNT(*) FROM meetup_answers g WHERE g.meetup = m.id AND g.answer = 'maybe') AS maybe
      FROM meetups m LEFT JOIN meetup_answers a ON a.meetup = m.id AND a.user = ?
      WHERE m.owner = ? OR a.user IS NOT NULL ORDER BY m.date, m.time`).bind(user, user)
      .all<Row & { my_answer: string | null; going: number; maybe: number }>();
    return json(200, { meetups: results.map((r) => ({ ...publicMeetup(r, user), answer: r.my_answer, counts: { going: r.going, maybe: r.maybe } })) });
  }

  const row = await getMeetup(db, first);
  if (!row) return json(404, { error: "not found" });

  if (!second && method === "GET") {
    const mine = user ? await db.prepare(`SELECT answer FROM meetup_answers WHERE meetup = ? AND user = ?`).bind(row.id, user).first<{ answer: string }>() : null;
    return json(200, { meetup: publicMeetup(row, user), counts: await counts(db, row.id), answer: mine?.answer ?? null, signedIn: !!user });
  }

  if (second === "answer" && method === "PUT") {
    if (!user) return json(401, { error: "sign in" });
    if (row.cancelled && body.answer) return json(409, { error: "cancelled" });
    if (body.answer == null) await db.prepare(`DELETE FROM meetup_answers WHERE meetup = ? AND user = ?`).bind(row.id, user).run();
    else if (ANSWERS.includes(body.answer)) await db.prepare(`INSERT INTO meetup_answers (meetup, user, answer, at) VALUES (?, ?, ?, ?)
      ON CONFLICT (meetup, user) DO UPDATE SET answer = excluded.answer, at = excluded.at`).bind(row.id, user, body.answer, now).run();
    else return json(400, { error: "answer" });
    return json(200, { counts: await counts(db, row.id), answer: body.answer ?? null });
  }

  if (!second && (method === "PUT" || method === "DELETE")) {
    if (!user) return json(401, { error: "sign in" });
    // Someone else's meetup looks the same as a missing one.
    if (row.owner !== user) return json(404, { error: "not found" });
    if (method === "DELETE") {
      await db.batch([
        db.prepare(`DELETE FROM meetup_answers WHERE meetup = ?`).bind(row.id),
        db.prepare(`DELETE FROM meetups WHERE id = ?`).bind(row.id),
      ]);
      return json(200, { ok: true });
    }
    if (typeof body.cancelled === "boolean" && Object.keys(body).length === 1) {
      await db.prepare(`UPDATE meetups SET cancelled = ?, updated = ? WHERE id = ?`).bind(body.cancelled ? 1 : 0, now, row.id).run();
    } else {
      const m = readMeetup(body, now);
      if ("error" in m) return json(400, m);
      await db.prepare(`UPDATE meetups SET title = ?, date = ?, time = ?, place = ?, town = ?, place_id = ?, lat = ?, lon = ?, note = ?, lang = ?, updated = ?
        WHERE id = ?`).bind(m.title, m.date, m.time, m.place, m.town, m.placeId, m.lat, m.lon, m.note, m.lang, now, row.id).run();
    }
    return json(200, { meetup: publicMeetup((await getMeetup(db, row.id))!, user) });
  }
  return json(404, { error: "not found" });
}
