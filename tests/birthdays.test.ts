import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBirthdays, parentPicks, parseBirthdays } from "../src/lib/birthdays.ts";

test("the birthdays file loads, every note in all three languages", () => {
  const b = loadBirthdays();
  assert.ok(b.towns.length >= 5);
  for (const t of b.towns) for (const p of t.items) for (const l of ["de", "en", "zh"]) assert.ok((p.note as any)[l], `${t.slug} ${p.name} ${l}`);
});

test("a party place needs an https link and an age as a number", () => {
  const one = (item: object) => ({ checked: "2026-11-12", towns: [{ slug: "koeln", town: "Köln", items: [item] }] });
  assert.throws(() => parseBirthdays(one({ name: "x", note: "y", url: "http://a.de" })), /https/);
  assert.throws(() => parseBirthdays(one({ name: "x", note: "y", url: "https://a.de", from: "vier" })), /from/);
  assert.equal(parseBirthdays(one({ name: "x", note: "y", url: "https://a.de", from: 4 })).towns[0].items[0].from, 4);
});

test("a parents' pick needs two yes votes, or a yes from a source", () => {
  const p = (birthday: any) => ({ id: "x", facilities: birthday ? { birthday } : {} });
  const picks = parentPicks([
    p({ status: "yes", confirmed: 0, byVotes: true, votes: { yes: 1, no: 0 } }),
    p({ status: "yes", confirmed: 0, byVotes: true, votes: { yes: 2, no: 1 } }),
    p({ status: "yes", confirmed: 1 }),
    p({ status: "no", confirmed: 0, byVotes: true, votes: { yes: 2, no: 3 } }),
    p(undefined),
  ]);
  assert.equal(picks.length, 2);
});
