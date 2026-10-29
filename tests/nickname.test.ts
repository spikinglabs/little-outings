import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanNick, firstSendHint, myNick, randomNick } from "../src/lib/nickname.ts";

const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

test("a random nickname is a friendly word and an animal in the page's language", () => {
  assert.equal(randomNick("en", () => 0), "Brave Hedgehog");
  assert.equal(randomNick("de", () => 0), "Mutiger Igel");
  assert.equal(randomNick("zh", () => 0), "勇敢的小刺猬");
  assert.equal(randomNick("fr", () => 0), "Brave Hedgehog");
});

test("cleanNick keeps short nicknames and drops contact details", () => {
  assert.equal(cleanNick("  Fuchs   Mama "), "Fuchs Mama");
  assert.equal(cleanNick("<b>x</b>"), "bx/b");
  assert.equal(cleanNick("a".repeat(50)).length, 30);
  for (const bad of ["me@mail.de", "www.example", "https://x.y", "0176 12345678", 5]) assert.equal(cleanNick(bad), "");
});

test("myNick makes one up once and keeps it; an emptied one stays anonymous", () => {
  const s = mem();
  const first = myNick(s, "en");
  assert.ok(first);
  assert.equal(myNick(s, "de"), first);
  s.setItem("lo-nick", "");
  assert.equal(myNick(s, "en"), "");
});

test("the first-send hint shows once", () => {
  const s = mem();
  assert.equal(firstSendHint(s), true);
  assert.equal(firstSendHint(s), false);
});
