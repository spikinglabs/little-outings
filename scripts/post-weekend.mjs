// Posts this weekend's edition to each town's Telegram channel (src/lib/weekend.ts, TELEGRAM), on
// Friday morning from .github/workflows/weekend-post.yml, after the deploy published the pages.
// Needs the repository secret TELEGRAM_BOT_TOKEN (from @BotFather); the bot must be an admin of each
// channel. Without the token or any channel it says so and posts nothing.
//
//   TELEGRAM_BOT_TOKEN=… npm run post:weekend
//   DRY_RUN=1 npm run post:weekend          prints the posts instead
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WEEKEND_TOWNS, addDays, telegramChannel, telegramText, townSlug } from "../src/lib/weekend.ts";

const DIR = process.env.WEEKEND_DIR || "data/weekend";
const SITE = (process.env.SITE_URL || "https://outings.allo.land").replace(/\/$/, "");
const today = process.env.WEEKEND_TODAY || new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
const token = process.env.TELEGRAM_BOT_TOKEN;
const dry = !!process.env.DRY_RUN;

/** The newest edition of a town while its weekend isn't over. */
export function latest(dir, slug, day) {
  const d = join(dir, slug);
  if (!existsSync(d)) return null;
  const file = readdirSync(d).filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f)).sort().pop();
  const ed = file && JSON.parse(readFileSync(join(d, file), "utf8"));
  return ed && day <= addDays(ed.weekend, 1) ? ed : null;
}

async function main() {
  if (!token && !dry) return console.log("::notice title=Telegram::No TELEGRAM_BOT_TOKEN secret; nothing posted.");
  let posted = 0;
  for (const town of WEEKEND_TOWNS) {
    const slug = townSlug(town), channel = telegramChannel(slug);
    if (!channel) { console.log(`telegram: no channel for ${town} (TELEGRAM in src/lib/weekend.ts)`); continue; }
    const ed = latest(DIR, slug, today);
    if (!ed) { console.log(`telegram: no edition for ${town} this weekend`); continue; }
    const page = `${SITE}/de/wochenende/${slug}/?von=telegram`;
    const text = telegramText(ed, { lang: "de", town, url: page, site: SITE });
    if (dry) { console.log(`--- ${channel}\n${text}`); continue; }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: channel, text, parse_mode: "HTML", link_preview_options: { url: page, prefer_large_media: true } }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) throw new Error(`telegram: ${channel}: ${body.description ?? res.status}`);
    posted++;
  }
  console.log(`telegram: posted ${posted} edition(s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
