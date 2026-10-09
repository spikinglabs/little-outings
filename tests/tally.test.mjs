import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBody, tally } from "../scripts/tally-inbox.mjs";
import { applyTally } from "../src/lib/merge.ts";

const issue = (lines, extra = {}) => ({ body: "```yaml\n" + lines.join("\n") + "\n```\n", labels: [], state: "open", ...extra });

test("parseBody reads the inbox YAML", () => {
  assert.deepEqual(parseBody(issue(['kind: visit', 'item: "x"', 'good_for: ["rainy"]']).body), { kind: "visit", item: "x", good_for: ["rainy"] });
  assert.equal(parseBody("no block"), null);
});

test("tally counts facility votes, visits and only approved tips", () => {
  const t = tally([
    issue(['kind: answer', 'item: "cafe-a"', 'gap: "fac"', 'feature: "changing_table"', 'answer: "yes"']),
    issue(['kind: answer', 'item: "cafe-a"', 'gap: "fac"', 'feature: "changing_table"', 'answer: "no"']),
    issue(['kind: answer', 'item: "cafe-a"', 'gap: "fac"', 'feature: "changing_table"', 'answer: "unsure"']),
    issue(['kind: answer', 'item: "cafe-a"', 'gap: "fac"', 'feature: "changing_table"', 'answer: "yes"'], { state_reason: "not_planned" }),
    issue(['kind: visit', 'item: "cafe-a"', 'again: "yes"', 'good_for: ["rainy", "toddlers"]']),
    issue(['kind: visit', 'item: "cafe-a"', 'again: "no"', 'good_for: ["rainy"]']),
    issue(['kind: tip', 'item: "cafe-a"', 'topic: "parking"', 'text: "Park behind"'], { labels: [{ name: "approved" }] }),
    issue(['kind: tip', 'item: "cafe-a"', 'topic: "other"', 'text: "unreviewed"']),
  ]);
  assert.deepEqual(t["cafe-a"], {
    fac: { changing_table: { yes: 1, no: 1 } },
    visits: { count: 2, again: 1, good_for: { rainy: 2, toddlers: 1 } },
    tips: [{ topic: "parking", text: "Park behind" }],
  });
});

const place = (facilities = {}) => ({ type: "place", id: "p", kind: "cafe", name: "P", town: "T", geo: { precision: "unknown" }, facilities, quotes: [], trust: { level: "community" } });

test("three yes votes and no no settle an unknown facility", () => {
  const p = applyTally(place(), { fac: { highchairs: { yes: 3, no: 0 }, toys: { yes: 3, no: 1 } } });
  assert.deepEqual(p.facilities.highchairs, { status: "yes", confirmed: 3, votes: { yes: 3, no: 0 } });
  assert.equal(p.facilities.toys.status, "unknown");
});

test("votes never overrule a known fact, they only annotate it", () => {
  const p = applyTally(place({ playground: { status: "yes", confirmed: 0 } }), { fac: { playground: { yes: 0, no: 5 } } });
  assert.deepEqual(p.facilities.playground, { status: "yes", confirmed: 0, votes: { yes: 0, no: 5 } });
});

test("inbox visits add to the moderator's tally", () => {
  const p = applyTally({ ...place(), visits: { count: 2, again: 1, good_for: { rainy: 1 } } }, { visits: { count: 1, again: 1, good_for: { rainy: 1, friends: 1 } } });
  assert.deepEqual(p.visits, { count: 3, again: 2, good_for: { rainy: 2, friends: 1 } });
});

test("live tap counts add onto inbox tallies", async () => {
  const { addCounts } = await import("../scripts/tally-inbox.mjs");
  const all = addCounts({ a: { fac: { toys: { yes: 1, no: 0 } } } },
    { a: { fac: { toys: { yes: 2, no: 1 } }, visits: { count: 1, again: 1, good_for: { rainy: 1 } } }, b: { fac: { parking: { yes: 1, no: 0 } } } });
  assert.deepEqual(all, { a: { fac: { toys: { yes: 3, no: 1 } }, visits: { count: 1, again: 1, good_for: { rainy: 1 } } }, b: { fac: { parking: { yes: 1, no: 0 } } } });
});

test("language answers from the inbox and from taps add up", async () => {
  const { addCounts } = await import("../scripts/tally-inbox.mjs");
  const body = "```yaml\nkind: answer\nitem: \"ck-evt-1\"\ngap: \"lang\"\nanswer: \"none\"\n```";
  const all = tally([{ body, labels: [] }]);
  assert.deepEqual(addCounts(all, { "ck-evt-1": { lang: { none: 1, de: 2 } } })["ck-evt-1"].lang, { none: 2, de: 2 });
});
