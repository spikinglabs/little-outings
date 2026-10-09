import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { textsIn, update } from "../scripts/translate.mjs";

// A fake Gemini endpoint: echoes each sent text back as "中:<text>", or answers `list` as given.
const answer = (list) => async (_url, req) => {
  const sent = JSON.parse(JSON.parse(req.body).contents[0].parts[0].text);
  const text = JSON.stringify(list ?? sent.map((x) => `中:${x.text}`));
  return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
};
const llm = { provider: "gemini", key: "k" };

test("collects German titles and names, skipping ones translated by hand", () => {
  const root = mkdtempSync(join(tmpdir(), "lo-"));
  mkdirSync(join(root, "imported", "cityklub"), { recursive: true });
  mkdirSync(join(root, "places"), { recursive: true });
  writeFileSync(join(root, "imported", "cityklub", "a.yaml"), "title: Hoffest\n");
  writeFileSync(join(root, "imported", "cityklub", "b.yaml"), "title: { de: Lesung, zh: 朗读 }\n");
  writeFileSync(join(root, "places", "c.yaml"), "kind: playground\nname: Schanzenweg\n");
  assert.deepEqual(textsIn(root), [{ text: "Hoffest", kind: "event" }, { text: "Schanzenweg", kind: "playground" }]);
});

test("translates only what is missing and drops what nothing uses", async () => {
  const items = [{ text: "Hoffest", kind: "event" }, { text: "Lesung", kind: "event" }];
  let calls = 0;
  const fetch = async (...a) => { calls++; return answer()(...a); };
  const r = await update(items, { Hoffest: "农场节", Alt: "旧" }, { llm, model: "m", fetch });
  assert.deepEqual(r.cache, { Hoffest: "农场节", Lesung: "中:Lesung" });
  assert.equal(calls, 1);
  assert.equal(r.done, 1);
});

test("without a key, or with a broken answer, nothing new is written", async () => {
  const items = [{ text: "Hoffest", kind: "event" }];
  assert.deepEqual((await update(items, {}, {})).cache, {});
  const r = await update(items, {}, { llm, model: "m", fetch: answer(["a", "b"]) });
  assert.deepEqual(r.cache, {});
  assert.equal(r.missing, 1);
});
