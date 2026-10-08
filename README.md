# Little Outings

Family outings near you: kid-friendly places (cafés, farms, playgrounds) and local
events (Hoffeste, Martinszüge, flea markets), in German, English and Chinese.
A spikinglabs project. Events come from the public export of
[cityklub-event-data](https://github.com/spikinglabs/cityklub-event-data) plus
hand-curated files and parents' tips.

**Files in git are the database.** Every place and event is one Markdown or YAML
file. The site is static (Astro) and hosts for free on Cloudflare Pages.

## Run it

```sh
npm install
npm run demo        # dev server with the fictional demo data in examples/
npm run dev         # dev server with the real data in content/
npm test            # import + gap logic tests
npm run build       # validates every content file and builds dist/
```

## Where things live

| Path | What |
|---|---|
| `content/places/<region>/<slug>.md` | One place. Facilities are `yes` / `no` / `unknown` with a count of parents who confirmed. |
| `content/events/<year>/<slug>.md` | One hand-added event. `place: <slug>` inherits the place's address, position and facilities. |
| `content/imported/cityklub/` | Generated nightly by `scripts/import-cityklub.mjs`. Never edit. |
| `content/overrides/<id>.yaml` | Fixes for imported events (any event field, or `hidden: true`). Never overwritten. |
| `content/answers/<id>.yaml` | Community answers merged by the inbox bot. |
| `content/regions/<slug>.yaml` | Towns of a region, used for "town only" locations and the "Rund um" picker. |
| `examples/` | Fictional demo data, used only by `npm run demo` and `build:demo`. |
| `i18n/{de,en,zh}.yaml` | All UI text. |
| `design/tokens.css` | Design kit colours and type. |
| `src/content.config.ts` | Schemas. A file that doesn't match fails the build. |
| `functions/api/` | The only server code: `inbox` (contributions → GitHub issues) and `parse` (poster/link/text → draft). |
| `public/admin/` | Sveltia CMS for editing content through forms. |

Merge order for an event: **imported < answers < overrides**.

**Missing is allowed.** Only a title, a start date and a town (or place) are
required. Every missing field (where exactly, time, price, opening hours,
facilities, "still on?") becomes a quick task on the Mitmachen page and in
`/api/v1/tasks.json`.

**Location precision** follows cityklub's map levels: `exact` (solid pin),
`venue` (pin with a dashed ring, "Ort ungefähr"), `area` (town centre, "Nur
Stadt bekannt", shaded circle), `unknown` (not listed or mapped; only a task).

## Static API

Built with the site, for the future spikinglabs app and other tools:
`/api/v1/events.json`, `/api/v1/places.json`, `/api/v1/tasks.json`.

## Deploy (Cloudflare Pages)

`.github/workflows/deploy.yml` deploys with Wrangler: every push to `main` goes
to production, every pull request gets a preview URL (in the run summary), and
every night at 02:15 UTC it imports the cityklub export and rebuilds, because
"today" and "this weekend" move. `ci.yml` runs tests, type check and both builds
on every PR.

One-time setup, in GitHub → Settings → Secrets and variables → Actions:
- Secrets `CLOUDFLARE_API_TOKEN` (a token with *Cloudflare Pages: Edit*) and
  `CLOUDFLARE_ACCOUNT_ID`. The first deploy creates the `little-outings` Pages project.
- Variables `CITYKLUB_EXPORT` (URL of the public `events.jsonl`) and, once you
  have a domain, `SITE_URL`.

Without the Cloudflare secrets the deploy step is skipped and runs stay green.

Optional, in Cloudflare → Pages → little-outings → Settings → Variables:
- Inbox: `GITHUB_TOKEN` (Issues: write on the inbox repo only), `INBOX_REPO`,
  optional `TURNSTILE_SECRET`.
- Poster/link parsing: `ANTHROPIC_API_KEY`, `PARSE_MODEL`. Photos are sent to the
  model for that one request and never stored.
- Without these the site works; contributions say "being set up".
