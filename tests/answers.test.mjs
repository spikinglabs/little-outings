import { test } from "node:test";
import assert from "node:assert/strict";
import { agreement, sameKey } from "../admin/lib/answers.js";
import { tally } from "../scripts/tally-inbox.mjs";
import { reviewItem, actionsOf } from "../admin/lib/inbox.js";

const issue = (number, lines, extra = {}) => ({ number, body: "```yaml\n" + lines.join("\n") + "\n```\n", labels: [{ name: "answer" }], state: "open", ...extra });
const hours = (n, answer, from, extra) => issue(n, ["kind: answer", 'item: "zoo-a"', 'gap: "hours"', `answer: ${JSON.stringify(answer)}`, from ? `from: "${from}"` : ""], extra);

test("sameKey ignores spelling, not content", () => {
  assert.equal(sameKey("hours", "Mo–Fr 9:00–17:00 Uhr"), sameKey("hours", "mo-fr 9-17"));
  assert.notEqual(sameKey("hours", "Mo-Fr 9-17"), sameKey("hours", "Mo-Fr 9-18"));
  assert.equal(sameKey("price", "Kostenlos"), "free");
  assert.equal(sameKey("price", "5 Euro"), sameKey("price", "5€"));
});

test("two browsers agreeing make it live; the same browser twice doesn't", () => {
  assert.equal(agreement("hours", [{ number: 1, value: "Mo-Fr 9-17", from: "a" }, { number: 2, value: "mo–fr 9–17", from: "b" }]).status, "agreed");
  assert.equal(agreement("hours", [{ number: 1, value: "Mo-Fr 9-17", from: "a" }, { number: 2, value: "Mo-Fr 9-17", from: "a" }]).status, "single");
  assert.equal(agreement("hours", [{ number: 1, value: "Mo-Fr 9-17", from: "a" }, { number: 2, value: "Sa 10-14", from: "b" }]).status, "conflict");
  // 2 against 1 still wins; 2 against 2 waits for the admin.
  assert.equal(agreement("hours", [{ number: 1, value: "x 1", from: "a" }, { number: 2, value: "x 1", from: "b" }, { number: 3, value: "y", from: "c" }]).value, "x 1");
  assert.equal(agreement("hours", [{ number: 1, value: "x", from: "a" }, { number: 2, value: "x", from: "b" }, { number: 3, value: "y", from: "c" }, { number: 4, value: "y", from: "d" }]).status, "conflict");
  assert.deepEqual(agreement("hours", [{ number: 1, value: "x", from: "a" }, { number: 2, value: "y", from: "b", approved: true }]).value, "y");
});

test("tally publishes agreed and approved answers only", () => {
  const t = tally([
    hours(1, "Mo-Fr 9-17", "a"), hours(2, "Mo–Fr 9–17 Uhr", "b"),
    issue(3, ["kind: answer", 'item: "ev-1"', 'gap: "price"', 'answer: "3 €"', 'from: "a"']),
    issue(4, ["kind: answer", 'item: "ev-1"', 'gap: "time"', 'answer: "15 Uhr"'], { labels: [{ name: "answer" }, { name: "approved" }], state: "closed" }),
    issue(5, ["kind: answer", 'item: "ev-2"', 'gap: "time"', 'answer: "10"', 'from: "a"']),
    issue(6, ["kind: answer", 'item: "ev-2"', 'gap: "time"', 'answer: "10"', 'from: "b"'], { state_reason: "not_planned" }),
  ]);
  assert.deepEqual(t["zoo-a"].answers, { hours: "Mo-Fr 9-17" });
  assert.deepEqual(t["ev-1"].answers, { time: "15 Uhr" });
  assert.equal(t["ev-2"], undefined);
});

test("the admin reviews text answers, not votes", () => {
  assert.equal(reviewItem(hours(1, "Mo-Fr 9-17", "a")).kind, "answer");
  assert.equal(reviewItem(issue(2, ["kind: answer", 'item: "x"', 'gap: "fac"', 'feature: "toilets"', 'answer: "yes"'])), null);
  const where = reviewItem(issue(3, ["kind: answer", 'item: "x"', 'gap: "where"', 'answer: "behind the church"']));
  assert.deepEqual(actionsOf(where), ["done", "reject"]);
  assert.deepEqual(actionsOf(reviewItem(hours(1, "x", "a"))), ["approve", "reject"]);
});
