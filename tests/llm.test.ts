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

test("the poster parser asks Claude when Gemini fails, notes each try, and shows the notes to the admin only", async () => {
  const { fakeD1 } = await import("./fake-d1.ts");
  const { onRequestGet } = await import("../functions/api/parse.ts");
  const DB = fakeD1();
  const KEY = "k".repeat(40);
  const req = () => new Request("https://x/api/parse", { method: "POST", body: JSON.stringify({ text: "Martinszug 11.11. 17:30" }) });
  const real = globalThis.fetch;
  const realErr = console.error;
  console.error = () => {};
  let claude = 200;
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("generativelanguage")) return new Response("model overloaded", { status: 503 });
    if (claude !== 200) return new Response("nope", { status: claude });
    return new Response(JSON.stringify({ content: [{ type: "text", text: '{"draft":{"title":"Martinszug"},"unsure":[]}' }] }));
  }) as typeof fetch;
  try {
    const env = { GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a", DB, MEETUP_ADMIN_KEY: KEY };
    const ok = await onRequestPost({ request: req(), env });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as any).draft.title, "Martinszug");

    claude = 402;
    const bad = await onRequestPost({ request: req(), env });
    assert.equal(bad.status, 500, "not 502, whose body Cloudflare replaces");
    assert.equal(((await bad.json()) as any).reason, "no_credits");

    const onlyGemini = await onRequestPost({ request: req(), env: { GEMINI_API_KEY: "g", DB } });
    assert.equal(((await onlyGemini.json()) as any).reason, "provider_error");

    const get = (key?: string) => onRequestGet({ request: new Request("https://x/api/parse?days=7", { headers: key ? { "x-admin-key": key } : {} }), env });
    assert.equal((await get()).status, 403);
    assert.equal((await get("wrong")).status, 403);
    const log: any = await (await get(KEY)).json();
    assert.equal(log.failures.length, 2);
    assert.equal(log.failures.find((f: any) => f.provider === "gemini+anthropic").reason, "no_credits");
    assert.match(log.failures.find((f: any) => f.provider === "gemini").detail, /HTTP 503 model overloaded/);
    assert.deepEqual(log.counts.find((c: any) => c.ok === 1), { day: log.counts[0].day, input: "text", ok: 1, provider: "anthropic", n: 1 });
    assert.ok(!JSON.stringify(log).includes("Martinszug"), "the text sent is never kept");
  } finally { globalThis.fetch = real; console.error = realErr; }
});

test("an empty Gemini answer is an error that says why", async () => {
  const fake = (async () => new Response(JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] }))) as unknown as typeof fetch;
  await assert.rejects(complete({ provider: "gemini", key: "g" }, "", { system: "S", text: "T", maxTokens: 10 }, fake), /empty answer \(MAX_TOKENS\)/);
});
