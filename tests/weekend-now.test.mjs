import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyWeekendEdit } from "../admin/lib/weekend.js";
import { onRequestGet, onRequestPost } from "../admin/functions/api/weekend-now.js";
import { comingWeekend } from "../admin/public/weekend-now.js";

const run = (env) => execFileSync("node", ["scripts/weekend-edition.mjs"], {
  env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, encoding: "utf8",
});

test("early publishes the coming weekend once; Thursday and Friday keep it", () => {
  const dir = mkdtempSync(join(tmpdir(), "weekend-now-"));
  const out = join(dir, "out"), draft = join(dir, "draft.json");
  cpSync("data/weekend", out, { recursive: true });
  const env = { WEEKEND_DIR: out, DRAFT_FILE: draft };
  run({ ...env, WEEKEND_TODAY: "2026-11-03", WEEKEND_MODE: "early" });
  const file = join(out, "koeln", "2026-11-07.json");
  assert.ok(existsSync(file));
  const first = readFileSync(file, "utf8");
  const doc = JSON.parse(readFileSync(draft, "utf8"));
  assert.equal(doc.weekend, "2026-11-07");
  assert.ok(doc.published_at);

  // Thursday's draft keeps the published one; Friday publishes nothing new over it.
  assert.match(run({ ...env, WEEKEND_TODAY: "2026-11-05" }), /published early from the admin; kept/);
  assert.equal(JSON.parse(readFileSync(draft, "utf8")).published_at, doc.published_at);
  writeFileSync(draft, JSON.stringify({ ...doc, published_at: undefined }));
  assert.match(run({ ...env, WEEKEND_TODAY: "2026-11-06" }), /Köln 2026-11-07 is already published; kept/);
  assert.equal(readFileSync(file, "utf8"), first);
  // Pressing the button again changes nothing either.
  assert.match(run({ ...env, WEEKEND_TODAY: "2026-11-04", WEEKEND_MODE: "early" }), /published 0 edition/);
  assert.equal(readFileSync(file, "utf8"), first);
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
