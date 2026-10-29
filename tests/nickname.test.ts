import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanNick, randomNick } from "../src/lib/nickname.ts";

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
