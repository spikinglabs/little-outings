// Cloudflare Pages Function: POST /api/sent-status {items: [{number, key}]}
// Tells a family what happened to the events and places they suggested, so "What you sent" can say
// waiting, published or not added. The inbox repo stays private: only the sender's key (whose hash
// is in the issue) unlocks an item's status, and nothing else about the issue is returned.
//
//   waiting   open, not yet looked at (or a first version not yet approved)
//   changed   published before, and an edit by the sender is waiting for another look
//   published approved; the admin committed it to the site (it shows after the next deploy)
//   declined  rejected in the admin
import { gh, sha256, KEY, type Env } from "./inbox.ts";

const MAX = 50;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export type SentStatus = "waiting" | "changed" | "published" | "declined";

/** The status of one issue for the holder of `key`, or null when the key doesn't match. */
export async function statusOf(issue: { body?: string; state?: string; state_reason?: string | null; labels?: ({ name: string } | string)[] }, key: string): Promise<SentStatus | null> {
  const labels = (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
  const edit = /^edit: "([0-9a-f]{64})"$/m.exec(issue.body ?? "")?.[1];
  if (!(labels.includes("new-event") || labels.includes("new-place")) || !edit || edit !== (await sha256(key))) return null;
  if (issue.state === "closed") return issue.state_reason === "not_planned" ? "declined" : "published";
  return labels.includes("published") ? "changed" : "waiting";
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  if (!env.GITHUB_TOKEN || !env.INBOX_REPO) return json(503, { error: "inbox not configured" });
  if (Number(request.headers.get("content-length") ?? 0) > 20000) return json(413, { error: "too large" });
  let body: any;
  try { body = await request.json(); } catch { return json(400, { error: "invalid json" }); }
  const items = (Array.isArray(body?.items) ? body.items : [])
    .filter((i: any) => Number.isInteger(i?.number) && i.number > 0 && typeof i.key === "string" && KEY.test(i.key))
    .slice(0, MAX) as { number: number; key: string }[];
  const statuses: Record<number, SentStatus> = {};
  await Promise.all(items.map(async ({ number, key }) => {
    const res = await gh(env, `/issues/${number}`).catch(() => null);
    if (!res?.ok) return;
    const s = await statusOf(await res.json(), key);
    if (s) statuses[number] = s;
  }));
  return json(200, { statuses });
}
