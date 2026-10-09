// Cloudflare Pages Function: POST /api/inbox
// The only write path of the site. Each contribution (a new event draft, a suggested place or a gap answer)
// becomes an issue in a private GitHub repo. A GitHub Action there groups answers and opens
// a pull request on the site repo once two parents agree or a moderator adds `approved`.
//
// Environment (Cloudflare Pages → Settings → Variables):
//   GITHUB_TOKEN      fine-grained token with Issues: write on INBOX_REPO only
//   INBOX_REPO        e.g. spikinglabs/little-outings-inbox
//   TURNSTILE_SECRET  optional; when set, requests must carry a valid `turnstile` token
// Until GITHUB_TOKEN and INBOX_REPO are set, it answers 503 and the site says "being set up".

interface Env { GITHUB_TOKEN?: string; INBOX_REPO?: string; TURNSTILE_SECRET?: string }
type Ctx = { request: Request; env: Env };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const clip = (v: unknown, n = 500) => String(v ?? "").slice(0, n).replace(/\r/g, "");
// Quote everything so a contribution can never break the YAML the bot reads.
// Same lists as src/content.config.ts (functions can't import Astro's zod config).
const GOOD_FOR = ["toddlers", "bigKids", "rainy", "longVisit", "quickHour", "friends"];
const TIP_TOPICS = ["bring", "bestTime", "parking", "ages", "other"];
const yamlStr = (v: unknown, n?: number) => JSON.stringify(clip(v, n));

export async function onRequestPost({ request, env }: Ctx) {
  if (!env.GITHUB_TOKEN || !env.INBOX_REPO) return json(503, { error: "inbox not configured" });
  if (Number(request.headers.get("content-length") ?? 0) > 20000) return json(413, { error: "too large" });
  let body: any;
  try { body = await request.json(); } catch { return json(400, { error: "invalid json" }); }

  if (env.TURNSTILE_SECRET) {
    const form = new FormData();
    form.append("secret", env.TURNSTILE_SECRET);
    form.append("response", clip(body.turnstile, 2048));
    form.append("remoteip", request.headers.get("cf-connecting-ip") ?? "");
    const check = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    if (!((await check.json()) as any).success) return json(403, { error: "turnstile failed" });
  }

  let title: string, yaml: string, label: string;
  if (body.kind === "answer" && typeof body.gap === "string" && /^[a-z0-9-]+:[a-z]+(:[a-z_]+)?$/.test(body.gap)) {
    const [id, gap, feature] = body.gap.split(":");
    title = `answer ${body.gap}`;
    label = "answer";
    yaml = [`kind: answer`, `item: ${yamlStr(id, 80)}`, `gap: ${yamlStr(gap, 20)}`, feature ? `feature: ${yamlStr(feature, 40)}` : "",
      `answer: ${yamlStr(body.answer)}`, `lang: ${yamlStr(body.lang, 5)}`].filter(Boolean).join("\n");
  } else if (body.kind === "event" && body.draft && typeof body.draft === "object") {
    const d = body.draft;
    if (!d.title || !d.date) return json(400, { error: "title and date are required" });
    title = `event ${clip(d.date, 10)} ${clip(d.title, 80)}`;
    label = "new-event";
    yaml = [`kind: event`, ...["title", "date", "time", "place", "price", "note"].map((k) => `${k}: ${yamlStr(d[k], k === "note" ? 2000 : 300)}`),
      `lang: ${yamlStr(body.lang, 5)}`].join("\n");
  } else if (body.kind === "place" && body.place && typeof body.place === "object") {
    const p = body.place;
    if (!p.name || !p.kind || !p.town) return json(400, { error: "name, kind and town are required" });
    const features = (Array.isArray(p.features) ? p.features : []).slice(0, 20).map((f: unknown) => clip(f, 40)).filter((f: string) => /^[a-z_]+$/.test(f));
    title = `place ${clip(p.kind, 20)} ${clip(p.name, 80)}`;
    label = "new-place";
    yaml = [`kind: place`, ...["type", "name", "town", "street", "website", "note"].map((k) =>
      `${k}: ${yamlStr(k === "type" ? p.kind : p[k], k === "note" ? 2000 : 300)}`),
      `features: [${features.map((f: string) => JSON.stringify(f)).join(", ")}]`, `lang: ${yamlStr(body.lang, 5)}`].join("\n");
  } else if (body.kind === "visit" && typeof body.item === "string" && /^[a-z0-9-]+$/.test(body.item)
    && ["yes", "maybe", "no"].includes(body.again)) {
    const goodFor = (Array.isArray(body.good_for) ? body.good_for : []).filter((g: unknown) => GOOD_FOR.includes(g as string)).slice(0, 10);
    title = `visit ${body.again} ${clip(body.item, 80)}`;
    label = "visit";
    yaml = [`kind: visit`, `item: ${yamlStr(body.item, 80)}`, `again: ${yamlStr(body.again, 5)}`,
      `good_for: [${goodFor.map((g: string) => JSON.stringify(g)).join(", ")}]`, `lang: ${yamlStr(body.lang, 5)}`].join("\n");
  } else if (body.kind === "tip" && typeof body.item === "string" && /^[a-z0-9-]+$/.test(body.item)
    && TIP_TOPICS.includes(body.topic) && typeof body.text === "string" && body.text.trim()) {
    title = `tip ${body.topic} ${clip(body.item, 80)}`;
    label = "tip";
    yaml = [`kind: tip`, `item: ${yamlStr(body.item, 80)}`, `topic: ${yamlStr(body.topic, 20)}`,
      `text: ${yamlStr(body.text.trim(), 140)}`, `lang: ${yamlStr(body.lang, 5)}`].join("\n");
  } else if (body.kind === "report" && typeof body.item === "string" && /^[a-z0-9-]+$/.test(body.item)
    && ["closed", "cancelled", "where", "notKids", "outdated", "other"].includes(body.reason)) {
    title = `report ${body.reason} ${clip(body.item, 80)}`;
    label = "report";
    yaml = [`kind: report`, `item: ${yamlStr(body.item, 80)}`, `reason: ${yamlStr(body.reason, 20)}`,
      `note: ${yamlStr(body.note, 1000)}`, `lang: ${yamlStr(body.lang, 5)}`].join("\n");
  } else {
    return json(400, { error: "unknown contribution" });
  }

  const res = await fetch(`https://api.github.com/repos/${env.INBOX_REPO}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "little-outings-inbox",
    },
    body: JSON.stringify({ title, labels: [label], body: "```yaml\n" + yaml + "\n```\n" }),
  });
  return res.ok ? json(200, { ok: true }) : json(502, { error: "inbox unavailable" });
}
