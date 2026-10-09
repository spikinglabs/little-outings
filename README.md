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
every night at 02:15 UTC it rebuilds, because "today" and "this weekend" move.
Every build first imports cityklub events: `data/outings.jsonl` (published from
the admin) when it exists, otherwise the `CITYKLUB_EXPORT` variable. `ci.yml` runs tests, type check and both builds
on every PR.

One-time setup, in GitHub → Settings → Secrets and variables → Actions:
- Secrets `CLOUDFLARE_API_TOKEN` (a token with *Cloudflare Pages: Edit*) and
  `CLOUDFLARE_ACCOUNT_ID`. The first deploy creates the `little-outings` Pages project.
- Variables `CITYKLUB_EXPORT` (URL of the public `events.jsonl`) and, once you
  have a domain, `SITE_URL`.
- Chinese translations (`translate.yml`, nightly): secret `GEMINI_API_KEY` or
  `ANTHROPIC_API_KEY`; optional variables `LLM_PROVIDER` and `TRANSLATE_MODEL`.

Without the Cloudflare secrets the deploy step is skipped and runs stay green.

Optional, in Cloudflare → Pages → little-outings → Settings → Variables:
- Inbox: `GITHUB_TOKEN` (Issues: write on the inbox repo only), `INBOX_REPO`,
  optional `TURNSTILE_SECRET`.
- Poster/link parsing: `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` (with both, Gemini unless
  `LLM_PROVIDER=anthropic`), optional `PARSE_MODEL`. Photos are sent to the model for that
  one request and never stored.
- Without these the site works; contributions say "being set up".

## Admin (admin.outings.allo.land)

`admin/` is a separate Pages project, `little-outings-admin`, deployed from `main`
by the same workflow. It reads family-event candidates that cityklub writes every
night to the `spikinglabs-little-outings` R2 bucket (deduplicated, facts only), and
lets you include or exclude sources, hide or show single events, fix titles and
addresses, and **Publish**. Publishing commits `data/outings.jsonl` to this repo,
which triggers a normal deploy. The admin never reads cityklub's private bucket.

One-time setup:
1. R2: create the bucket `spikinglabs-little-outings` (no public access, no custom
   domain). In cityklub-event-data, let its R2 token write to it and add the secret
   `R2_LITTLE_OUTINGS_BUCKET=spikinglabs-little-outings`.
2. Zero Trust → Access → Applications: add a self-hosted application for
   `admin.outings.allo.land` with a policy allowing only your email. Copy its
   *Application Audience (AUD) tag*.
3. Pages → little-outings-admin → Custom domains: add `admin.outings.allo.land`.
4. Pages → little-outings-admin → Settings → Variables and Secrets (encrypted):
   `ACCESS_TEAM_DOMAIN` (e.g. `spikinglabs.cloudflareaccess.com`), `ACCESS_AUD`, and
   `GITHUB_TOKEN` (fine-grained, *Contents: read and write* on this repo only).
5. For the Inbox panel, also `INBOX_TOKEN` (fine-grained, *Issues: read and write* on
   `spikinglabs/little-outings-inbox` only). The panel lists open tips, reports and
   suggested events or places. Approve adds the `approved` label (an approved event is
   also committed as `content/events/community/inbox-<n>.yaml`, which deploys it), Done closes a
   report as completed, Reject closes as not planned; each leaves a comment saying
   who decided. `INBOX_REPO` and `SITE_URL` (for place and event names) are in
   `admin/wrangler.toml`.

Every request is checked against the Access token as well, so the admin refuses
everything until steps 2 and 4 are done. To try it locally, run
`cp design/tokens.css admin/public/ && npx wrangler pages dev` in `admin/`.
