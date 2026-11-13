// German place names stay German in Chinese (L, 2026-11-13: "德语地名不用翻译"): every prompt that writes
// Chinese carries the rule, the hand-written posts and season notes use no Chinese renderings of them, and
// translations made before the rule are asked again without losing the old one in the meantime.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ZH_NAMES, TRANSLATED_NAMES } from "../src/lib/zh-names.ts";
import { PROMPT, update } from "../scripts/translate.mjs";
import { PROMPT as ABOUT } from "../scripts/describe-events.mjs";
import { DETAIL as ALERT } from "../scripts/check-alerts.mjs";
import { LIST_PROMPT, DETAIL_PROMPT } from "../scripts/season-lists.mjs";
import { PICK_PROMPT, PLACE_PROMPT } from "../src/lib/weekend.ts";

test("every prompt that writes Chinese keeps German place names", () => {
  for (const p of [PROMPT, ABOUT, ALERT, LIST_PROMPT("Weihnachtsmärkte", "2026-11-13"), DETAIL_PROMPT("2026-11-13"), PICK_PROMPT, PLACE_PROMPT])
    assert.ok(p.includes(ZH_NAMES));
  assert.ok(!PROMPT.includes("科隆城市博物馆"), "the old example that translated a museum's name is gone");
});

test("posts and season notes use the German names", () => {
  const files = [
    ...readdirSync("posts").map((f) => join("posts", f)),
    ...readdirSync("content/seasons").flatMap((d) => readdirSync(join("content/seasons", d)).map((f) => join("content/seasons", d, f))),
  ];
  for (const f of files) {
    const body = readFileSync(f, "utf8").split("\n").filter((l) => !l.startsWith("#")).join("\n");
    for (const name of TRANSLATED_NAMES) assert.ok(!body.includes(name), `${f} says ${name}`);
  }
});

test("a recheck asks again, keeps the old translation until then, and leaves the list when done", async () => {
  const sent = [];
  const fetch = async (_url, req) => {
    const texts = JSON.parse(JSON.parse(req.body).contents[0].parts[0].text);
    sent.push(...texts.map((x) => x.text));
    const text = JSON.stringify(texts.map((x) => (x.text === "Beethovenpark" ? "Beethovenpark 公园" : `中:${x.text}`)));
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
  };
  const items = ["Beethovenpark", "Lesung", "Neu"].map((text) => ({ text, kind: "event" }));
  const recheck = new Set(["Beethovenpark"]);
  const cache = { Beethovenpark: "贝多芬公园", Lesung: "朗读" };
  // Over the limit: the new text goes first, the recheck waits and keeps its old translation.
  let r = await update(items, { ...cache }, { llm: { provider: "gemini", key: "k" }, fetch, limit: 1, recheck });
  assert.deepEqual(sent, ["Neu"]);
  assert.equal(r.cache.Beethovenpark, "贝多芬公园");
  assert.ok(recheck.has("Beethovenpark"));
  r = await update(items, r.cache, { llm: { provider: "gemini", key: "k" }, fetch, recheck });
  assert.equal(r.cache.Beethovenpark, "Beethovenpark 公园");
  assert.equal(r.cache.Lesung, "朗读");
  assert.equal(recheck.size, 0);
});

test("the recheck list only names texts the cache has", () => {
  const zh = JSON.parse(readFileSync("data/translations/zh.json", "utf8"));
  const list = JSON.parse(readFileSync("data/translations/zh-recheck.json", "utf8"));
  assert.ok(list.every((t) => t in zh));
});
