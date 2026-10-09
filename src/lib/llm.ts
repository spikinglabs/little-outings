// One small text (and image) completion, from Gemini or Claude. Used by the nightly translation
// (scripts/translate.mjs) and the poster parser (functions/api/parse.ts), so both follow one switch:
//
//   LLM_PROVIDER       "gemini" or "anthropic"; optional
//   GEMINI_API_KEY     Google AI Studio key
//   ANTHROPIC_API_KEY  Anthropic key
// Without LLM_PROVIDER, Gemini is used when GEMINI_API_KEY is set, otherwise Claude.
// Plain TypeScript without enums or other non-erasable syntax, so Node runs it directly.

export type Provider = "gemini" | "anthropic";
export type LlmEnv = { LLM_PROVIDER?: string; GEMINI_API_KEY?: string; ANTHROPIC_API_KEY?: string };
export type Llm = { provider: Provider; key: string };

/** Model used when the caller's model variable is empty: Google's alias for its current Flash model, Claude's small one. */
export const DEFAULT_MODEL: Record<Provider, string> = { gemini: "gemini-flash-latest", anthropic: "claude-haiku-5-5" };

/** The provider and key to use, or null when no key is set. */
export function pickLlm(env: LlmEnv): Llm | null {
  const want = env.LLM_PROVIDER?.trim().toLowerCase();
  if (want === "gemini") return env.GEMINI_API_KEY ? { provider: "gemini", key: env.GEMINI_API_KEY } : null;
  if (want === "anthropic" || want === "claude") return env.ANTHROPIC_API_KEY ? { provider: "anthropic", key: env.ANTHROPIC_API_KEY } : null;
  if (env.GEMINI_API_KEY) return { provider: "gemini", key: env.GEMINI_API_KEY };
  if (env.ANTHROPIC_API_KEY) return { provider: "anthropic", key: env.ANTHROPIC_API_KEY };
  return null;
}

export type Ask = {
  system: string;
  text?: string;
  image?: { mediaType: string; data: string }; // base64
  maxTokens: number;
  /** Ask for a JSON answer (Gemini supports a JSON mode; Claude is told in the prompt). */
  json?: boolean;
};

/** The model's text answer. Throws on an HTTP error, with the status in the message. */
export async function complete(llm: Llm, model: string | undefined, ask: Ask, fetchFn: typeof fetch = fetch): Promise<string> {
  const m = model?.trim() || DEFAULT_MODEL[llm.provider];
  if (llm.provider === "gemini") {
    const parts: unknown[] = [];
    if (ask.image) parts.push({ inline_data: { mime_type: ask.image.mediaType, data: ask.image.data } });
    if (ask.text) parts.push({ text: ask.text });
    const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": llm.key, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: ask.system }] },
        contents: [{ role: "user", parts }],
        generationConfig: { maxOutputTokens: ask.maxTokens, ...(ask.json ? { responseMimeType: "application/json" } : {}) },
      }),
    });
    if (!res.ok) throw new Error(`gemini: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const out: any = await res.json();
    return (out.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
  }
  const content: unknown[] = [];
  if (ask.image) content.push({ type: "image", source: { type: "base64", media_type: ask.image.mediaType, data: ask.image.data } });
  if (ask.text) content.push({ type: "text", text: ask.text });
  const res = await fetchFn("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": llm.key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: m, max_tokens: ask.maxTokens, system: ask.system, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) throw new Error(`anthropic: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const out: any = await res.json();
  return out.content?.find((c: any) => c.type === "text")?.text ?? "";
}
