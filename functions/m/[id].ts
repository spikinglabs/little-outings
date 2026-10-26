// Cloudflare Pages Function: /m/<id>, the page a parent shares for their meetup.
// It serves the static /<lang>/treffen/ page (which loads the meetup in the browser) with the meetup's
// own title and description in the head, so WhatsApp, Signal, Telegram and social sites show a proper
// preview card: their link fetchers read the HTML and never run scripts.
// The language is ?lang=, else the reader's browser language, else the one the meetup was written in.
import type { D1 } from "../api/taps.ts";
import { getMeetup } from "../api/meetups/[[path]].ts";

// Cloudflare's streaming HTML rewriter (a Workers global), as far as this page uses it.
interface El { setAttribute(name: string, value: string): void; setInnerContent(content: string): void }
declare const HTMLRewriter: { new (): { on(selector: string, handler: { element(el: El): void }): any; transform(res: Response): Response } };

interface Env { DB?: D1; ASSETS: { fetch(req: Request | string): Promise<Response> } }
type Ctx = { request: Request; env: Env; params: { id: string } };
type Lang = "de" | "en" | "zh";
const LANGS: Lang[] = ["de", "en", "zh"];

const TEXT: Record<Lang, { locale: string; join: string; off: string; fallback: string; site: string }> = {
  en: { locale: "en-GB", join: "Tap “We’re going” to join.", off: "Called off.", fallback: "A family meetup", site: "Little Outings" },
  de: { locale: "de-DE", join: "Tippe auf „Wir kommen“, um dabei zu sein.", off: "Abgesagt.", fallback: "Ein Familientreffen", site: "Little Outings" },
  zh: { locale: "zh-CN", join: "点“我们去”报名。", off: "已取消。", fallback: "家庭聚会", site: "小出游" },
};

export function pickLang(url: URL, acceptLanguage: string | null, meetupLang?: string): Lang {
  const q = url.searchParams.get("lang");
  if (LANGS.includes(q as Lang)) return q as Lang;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (LANGS.includes(code as Lang)) return code as Lang;
  }
  return LANGS.includes(meetupLang as Lang) ? (meetupLang as Lang) : "de";
}

/** Title and description for the preview card, e.g. "Picnic · Sat 18 Oct, 14:00" and "Rheinpark, Köln. Tap “Going” to join." */
export function previewText(m: { title: string; date: string; time: string | null; place: string; town: string | null; cancelled: number | boolean }, lang: Lang) {
  const t = TEXT[lang];
  const day = new Intl.DateTimeFormat(t.locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${m.date}T12:00:00Z`));
  const where = m.town && !m.place.includes(m.town) ? `${m.place}, ${m.town}` : m.place;
  return {
    title: `${m.cancelled ? `${t.off} ` : ""}${m.title} · ${day}${m.time ? `, ${m.time}` : ""}`,
    description: `${where}. ${m.cancelled ? t.off : t.join}`,
  };
}

export async function onRequestGet({ request, env, params }: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const id = String(params.id ?? "");
  let meetup = null;
  try { meetup = env.DB ? await getMeetup(env.DB, id) : null; } catch { /* the page shows "can't load" itself */ }
  const lang = pickLang(url, request.headers.get("accept-language"), meetup?.lang);
  const shell = await env.ASSETS.fetch(new Request(new URL(`/${lang}/treffen/`, url), { headers: request.headers }));
  const headers = new Headers(shell.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex");
  headers.delete("content-length");
  const page = new Response(shell.body, { status: shell.ok ? 200 : shell.status, headers });
  if (!meetup) return page;

  const { title, description } = previewText(meetup, lang);
  const meta = (attr: string, content: string) => ({ element(el: El) { el.setAttribute(attr, content); } });
  return new HTMLRewriter()
    .on("title", { element(el: El) { el.setInnerContent(`${title} · ${TEXT[lang].site}`); } })
    .on('meta[property="og:title"]', meta("content", title))
    .on('meta[property="og:image:alt"]', meta("content", title))
    .on('meta[itemprop="name"]', meta("content", title))
    .on('meta[property="og:description"]', meta("content", description))
    .on('meta[itemprop="description"]', meta("content", description))
    .on('meta[name="description"]', meta("content", description))
    .on('meta[property="og:url"]', meta("content", `${url.origin}/m/${id}`))
    .on('meta[property="og:image"]', meta("content", `${url.origin}/images/meetup-card.png`))
    .on('meta[name="twitter:image"]', meta("content", `${url.origin}/images/meetup-card.png`))
    .on('meta[itemprop="image"]', meta("content", `${url.origin}/images/meetup-card.png`))
    .transform(page);
}
