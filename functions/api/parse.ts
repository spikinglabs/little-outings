// Cloudflare Pages Function: POST /api/parse
// Reads a poster photo, a link or pasted text and returns a draft event for the parent to check.
// The photo is only passed to the model for this one request; it is never stored or published.
//
// Environment:
//   ANTHROPIC_API_KEY  API key
//   PARSE_MODEL        the (small, vision-capable) Claude model to use
// Until both are set, it answers 503 and the form opens empty for typing.

interface Env { ANTHROPIC_API_KEY?: string; PARSE_MODEL?: string }
type Ctx = { request: Request; env: Env };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const FIELDS = ["title", "date", "time", "place", "price", "note"];
const PROMPT = `You read announcements of family events in Germany (posters, web pages, chat messages).
Return only JSON: {"draft":{"title":"","date":"YYYY-MM-DD","time":"","place":"","price":"","note":""},"unsure":[]}.
- title: a short neutral title in your own words, in German. Do not copy slogans.
- date: the first day; assume the next upcoming occurrence if the year is missing. Today is {today}.
- time: like "14:00–17:00". place: venue and address or town. price: as written, or "kostenlos".
- note: one or two sentences about what there is for children, in German.
- unsure: names of fields you guessed or could not read. Leave unknown fields empty.`;

export async function onRequestPost({ request, env }: Ctx) {
  if (!env.ANTHROPIC_API_KEY || !env.PARSE_MODEL) return json(503, { error: "parsing not configured" });
  let body: any;
  try { body = await request.json(); } catch { return json(400, { error: "invalid json" }); }

  const content: any[] = [];
  if (typeof body.image === "string" && body.image.length < 7_000_000 && /^image\/(jpeg|png|webp|gif)$/.test(body.mediaType)) {
    content.push({ type: "image", source: { type: "base64", media_type: body.mediaType, data: body.image } });
  } else if (typeof body.url === "string" && /^https?:\/\//.test(body.url)) {
    const page = await fetch(body.url, { headers: { "user-agent": "little-outings parser" } }).catch(() => null);
    if (!page?.ok) return json(422, { error: "could not load link" });
    const text = (await page.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 20000);
    content.push({ type: "text", text: `Web page ${body.url}:\n${text}` });
  } else if (typeof body.text === "string" && body.text.trim()) {
    content.push({ type: "text", text: body.text.slice(0, 8000) });
  } else {
    return json(400, { error: "send image, url or text" });
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: env.PARSE_MODEL,
      max_tokens: 800,
      system: PROMPT.replace("{today}", today),
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) return json(502, { error: "parser unavailable" });
  const out: any = await res.json();
  const text = out.content?.find((c: any) => c.type === "text")?.text ?? "";
  try {
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const draft = Object.fromEntries(FIELDS.map((k) => [k, String(parsed.draft?.[k] ?? "").slice(0, 2000)]));
    const unsure = (parsed.unsure ?? []).filter((k: string) => FIELDS.includes(k));
    return json(200, { draft, unsure });
  } catch {
    return json(502, { error: "could not read the answer" });
  }
}
