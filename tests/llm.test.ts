import { test } from "node:test";
import assert from "node:assert/strict";
import { complete, pickLlm } from "../src/lib/llm.ts";
import { onRequestPost } from "../functions/api/parse.ts";

test("Gemini when its key is set, Claude otherwise, unless LLM_PROVIDER says which", () => {
  assert.deepEqual(pickLlm({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" }), { provider: "gemini", key: "g", fallback: { provider: "anthropic", key: "a" } });
  assert.deepEqual(pickLlm({ GEMINI_API_KEY: "g" }), { provider: "gemini", key: "g" });
  assert.deepEqual(pickLlm({ ANTHROPIC_API_KEY: "a" }), { provider: "anthropic", key: "a" });
  assert.deepEqual(pickLlm({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a", LLM_PROVIDER: "anthropic" }), { provider: "anthropic", key: "a" });
  assert.equal(pickLlm({ ANTHROPIC_API_KEY: "a", LLM_PROVIDER: "gemini" }), null, "the chosen provider has no key");
  assert.equal(pickLlm({}), null);
});

test("each provider gets its own request shape and default model", async () => {
  const seen: { url: string; body: any; headers: any }[] = [];
  const fake = (reply: unknown) => (async (url: string, init: RequestInit) => {
    seen.push({ url, body: JSON.parse(String(init.body)), headers: init.headers });
    return new Response(JSON.stringify(reply));
  }) as typeof fetch;
  const ask = { system: "S", text: "T", image: { mediaType: "image/png", data: "AAAA" }, maxTokens: 10, json: true };

  assert.equal(await complete({ provider: "gemini", key: "g" }, "", ask, fake({ candidates: [{ content: { parts: [{ text: "ok" }] } }] })), "ok");
  assert.match(seen[0].url, /models\/gemini-flash-latest:generateContent$/);
  assert.equal(seen[0].headers["x-goog-api-key"], "g");
  assert.equal(seen[0].body.systemInstruction.parts[0].text, "S");
  assert.deepEqual(seen[0].body.contents[0].parts, [{ inline_data: { mime_type: "image/png", data: "AAAA" } }, { text: "T" }]);
  assert.equal(seen[0].body.generationConfig.responseMimeType, "application/json");

  assert.equal(await complete({ provider: "anthropic", key: "a" }, "claude-x", ask, fake({ content: [{ type: "text", text: "hi" }] })), "hi");
  assert.equal(seen[1].url, "https://api.anthropic.com/v1/messages");
  assert.equal(seen[1].body.model, "claude-x");
  assert.equal(seen[1].body.system, "S");
});

test("Claude stands in for the rest of the run once Gemini is out of credits", async () => {
  const urls: string[] = [];
  let geminiStatus = 402;
  const fake = (async (url: string, init: RequestInit) => {
    urls.push(url);
    if (url.includes("generativelanguage")) return new Response("prepayment credits are depleted", { status: geminiStatus });
    assert.equal(JSON.parse(String(init.body)).model, "claude-haiku-5-5", "Claude's own model, not the Gemini one asked for");
    return new Response(JSON.stringify({ content: [{ type: "text", text: "claude" }] }));
  }) as typeof fetch;
  const ask = { system: "S", text: "T", maxTokens: 10 };
  const llm = pickLlm({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" })!;
  const real = console.log;
  console.log = () => {};
  try {
    // Two calls in flight when the credits run out: both end with Claude's answer.
    assert.deepEqual(await Promise.all([complete(llm, "gemini-pro", ask, fake), complete(llm, "gemini-pro", ask, fake)]), ["claude", "claude"]);
    assert.equal(llm.provider, "anthropic");
    urls.length = 0;
    assert.equal(await complete(llm, "gemini-pro", ask, fake), "claude");
    assert.deepEqual(urls, ["https://api.anthropic.com/v1/messages"], "Gemini is not asked again");
  } finally { console.log = real; }

  // Other Gemini errors, or no Claude key, still fail.
  geminiStatus = 400;
  await assert.rejects(complete(pickLlm({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" })!, "", ask, fake), /HTTP 400/);
  geminiStatus = 402;
  await assert.rejects(complete(pickLlm({ GEMINI_API_KEY: "g" })!, "", ask, fake), /HTTP 402/);
  await assert.rejects(complete(pickLlm({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a", LLM_PROVIDER: "gemini" })!, "", ask, fake), /HTTP 402/);
});

test("the poster parser answers 503 without a key and reads Gemini's answer with one", async () => {
  const req = () => new Request("https://x/api/parse", { method: "POST", body: JSON.stringify({ text: "Hoffest am Samstag" }) });
  assert.equal((await onRequestPost({ request: req(), env: {} })).status, 503);
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '{"draft":{"title":"Hoffest","date":"2026-10-10"},"unsure":["time"]}' }] } }],
  }))) as typeof fetch;
  try {
    const res = await onRequestPost({ request: req(), env: { GEMINI_API_KEY: "g" } });
    const out: any = await res.json();
    assert.equal(out.draft.title, "Hoffest");
    assert.deepEqual(out.unsure, ["time"]);
  } finally { globalThis.fetch = real; }
});
