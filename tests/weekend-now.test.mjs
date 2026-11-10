import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyWeekendEdit } from "../admin/lib/weekend.js";
import { onRequestGet, onRequestPost } from "../admin/functions/api/weekend-now.js";
import { comingWeekend } from "../admin/public/weekend-now.js";

// The published editions before the weekend a test makes, so it doesn't meet the real one once main has it.
const pastEditions = (out, before) =>
  cpSync("data/weekend", out, { recursive: true, filter: (src) => !/\d{4}-\d\d-\d\d\.json$/.test(src) || src.slice(-15, -5) < before });

const run = (env) => execFileSync("node", ["scripts/weekend-edition.mjs"], {
  env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, encoding: "utf8",
});

// These run the real script on the real data/outings.jsonl, which drops past events: so they use the
// next weekend that is still ahead (its Monday … Friday as the run days), not a fixed date.
const iso = (d) => d.toISOString().slice(0, 10);
const SAT = (() => { const d = new Date(); d.setUTCHours(12, 0, 0, 0); do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() !== 6); return iso(d); })();
const day = (n) => iso(new Date(Date.parse(`${SAT}T12:00:00Z`) + n * 86400000));

test("early publishes the coming weekend once; later runs keep its picks", () => {
  const dir = mkdtempSync(join(tmpdir(), "weekend-now-"));
  const out = join(dir, "out"), draft = join(dir, "draft.json");
  pastEditions(out, SAT);
  const env = { WEEKEND_DIR: out, DRAFT_FILE: draft };
  run({ ...env, WEEKEND_TODAY: day(-4), WEEKEND_MODE: "early" });
  const file = join(out, "koeln", `${SAT}.json`);
  assert.ok(existsSync(file));
  const first = readFileSync(file, "utf8");
  const doc = JSON.parse(readFileSync(draft, "utf8"));
  assert.equal(doc.weekend, SAT);
  assert.ok(doc.published_at);

  // Thursday leaves it alone; Friday's refresh keeps its picks in order.
  assert.match(run({ ...env, WEEKEND_TODAY: day(-2) }), /nothing to do/);
  assert.equal(JSON.parse(readFileSync(draft, "utf8")).published_at, doc.published_at);
  assert.match(run({ ...env, WEEKEND_TODAY: day(-1) }), new RegExp(`Köln ${SAT} refreshed`));
  const picks = (f) => JSON.parse(f).picks.map((p) => p.id);
  assert.deepEqual(picks(readFileSync(file, "utf8")).slice(0, picks(first).length), picks(first));
  // Publishing again (by hand, a Saturday catch-up) never writes over it.
  const fri = readFileSync(file, "utf8");
  writeFileSync(draft, JSON.stringify({ ...doc, published_at: undefined }));
  assert.match(run({ ...env, WEEKEND_TODAY: day(-1), WEEKEND_MODE: "publish" }), new RegExp(`Köln ${SAT} is already published; kept`));
  assert.equal(readFileSync(file, "utf8"), fri);
  // Pressing the button again changes nothing either.
  assert.match(run({ ...env, WEEKEND_TODAY: day(-3), WEEKEND_MODE: "early" }), /published 0 edition/);
  assert.equal(readFileSync(file, "utf8"), fri);
});

test("Monday publishes the coming weekend, Friday refreshes it and keeps the codes", () => {
  const dir = mkdtempSync(join(tmpdir(), "weekend-mon-fri-"));
  const out = join(dir, "out"), draft = join(dir, "draft.json"), outings = join(dir, "outings.jsonl");
  pastEditions(out, SAT);
  cpSync("data/outings.jsonl", outings);
  const env = { WEEKEND_DIR: out, DRAFT_FILE: draft, OUTINGS_FILE: outings };
  assert.match(run({ ...env, WEEKEND_TODAY: day(-5) }), /published \d+ edition/);
  const file = join(out, "koeln", `${SAT}.json`);
  const monday = JSON.parse(readFileSync(file, "utf8"));
  assert.ok(JSON.parse(readFileSync(draft, "utf8")).published_at);
  // Tuesday to Thursday: nothing.
  assert.match(run({ ...env, WEEKEND_TODAY: day(-2) }), /nothing to do/);
  assert.equal(JSON.stringify(JSON.parse(readFileSync(file, "utf8"))), JSON.stringify(monday));

  // The first Köln event sells out during the week.
  const gone = monday.picks.find((p) => p.type === "event");
  const rows = readFileSync(outings, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  for (const r of rows) if (`ck-${r.event_id.replace(/_/g, "-")}` === gone.id) r.sold_out = true;
  writeFileSync(outings, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  assert.match(run({ ...env, WEEKEND_TODAY: day(-1) }), new RegExp(`Köln ${SAT} refreshed: 1 pick\\(s\\) no longer on, 1 new`));
  const friday = JSON.parse(readFileSync(file, "utf8"));
  assert.ok(friday.refreshed_at);
  assert.equal(friday.published_at, monday.published_at);
  // Monday's picks keep their places (and so their codes); the new one comes at the end.
  assert.deepEqual(friday.picks.slice(0, monday.picks.length).map((p) => p.id), monday.picks.map((p) => p.id));
  assert.equal(friday.picks.length, monday.picks.length + 1);
  assert.equal(friday.picks.at(-1).type, "event");
  assert.ok(!monday.picks.some((p) => p.id === friday.picks.at(-1).id));
});

test("a published draft takes no more swaps", () => {
  const draft = { weekend: "2026-11-07", published_at: "2026-11-03T07:00:00Z", towns: { Köln: { picks: [{ id: "a" }], alternates: [{ id: "b" }] } } };
  assert.throws(() => applyWeekendEdit(draft, { towns: { Köln: { picks: [{ id: "b" }] } } }), /already published/);
});

test("the coming weekend is counted in Germany", () => {
  assert.deepEqual(comingWeekend(new Date("2026-11-03T06:00:00Z")), { sat: "2026-11-07", label: "7–8 Nov" });
  assert.equal(comingWeekend(new Date("2026-10-27T06:00:00Z")).label, "31 Oct–1 Nov");
  assert.equal(comingWeekend(new Date("2026-11-07T23:30:00Z")).sat, "2026-11-07"); // Sunday 00:30 in Berlin
  assert.equal(comingWeekend(new Date("2026-11-06T23:30:00Z")).sat, "2026-11-07");
});

test("the button starts the workflow, but not twice, and says when the token can't", async () => {
  const env = { GITHUB_TOKEN: "t", GITHUB_REPO: "o/r" };
  const calls = [];
  const real = globalThis.fetch;
  let runs = [{ status: "completed", conclusion: "success", created_at: "2026-11-03T06:00:00Z", html_url: "https://x" }];
  let dispatch = 204;
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method ?? "GET", url, init.body]);
    if (url.endsWith("/dispatches")) return new Response(null, { status: dispatch });
    return Response.json({ workflow_runs: runs });
  };
  try {
    const got = await (await onRequestGet({ env })).json();
    assert.equal(got.run.conclusion, "success");
    const ok = await onRequestPost({ env });
    assert.equal(ok.status, 200);
    assert.deepEqual(calls.at(-1), ["POST", "https://api.github.com/repos/o/r/actions/workflows/weekend-now.yml/dispatches", JSON.stringify({ ref: "main" })]);

    runs = [{ status: "in_progress", conclusion: null, created_at: "2026-11-03T06:05:00Z", html_url: "https://x" }];
    assert.equal((await onRequestPost({ env })).status, 409);

    runs = [];
    dispatch = 403;
    const denied = await onRequestPost({ env });
    assert.equal(denied.status, 502);
    assert.match((await denied.json()).error, /Actions: Read and write/);
  } finally {
    globalThis.fetch = real;
  }
});
