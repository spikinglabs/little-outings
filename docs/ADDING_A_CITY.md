# Adding a city

A city touches three repos. With this list it is about two hours of work plus one night of runs.
Berlin, Munich, Frankfurt, Hamburg and Düsseldorf were added this way (little-outings PRs 70, 73, 74;
cityklub-event-data PRs 9, 16, 17, 20). Do the steps in order: each one feeds the next.

## 0. Pick the city

- Prefer large cities with many young families and a city or library calendar that lists children's
  events (that one source often brings more events than ten venue sites).
- Check that the Bundesland's school holidays are available: `scripts/fetch-holidays.mjs` lists the
  states it fetches (`STATES`).
- Write the probe notes to the project's `notes/<city>-family-sources.md`: per source, the number of
  upcoming events, how many are for families, and why a source is not collected (robots.txt,
  JavaScript-only pages, no dates).

## 1. Events: spikinglabs/cityklub-event-data

1. Sources: one YAML file per source under `config/<city>-sources/de/<city>/`, ids prefixed with the
   city (`hamburg-`, `muenchen-`). Copy a source of the same adapter type (JSON feed, iCal, HTML
   cards) from an earlier city and adjust URL, selectors and rights. Aim for 14 to 20 sources.
2. `config/app-<city>.yaml`: copy `config/app-duesseldorf.yaml` and change `source_directory`.
3. A fixture per enabled source in `tests/fixtures/enabled/` and the city in
   `tests/test_enabled_source_contracts.py`, `CITIES` in `tests/test_private_collection_workflow.py`.
4. Workflows:
   - `.github/workflows/collect-events.yaml`: add a "Collect <City> sources privately" step (its own
     `id`, `continue-on-error: true`, `timeout-minutes: 20`), the city in the validate and health
     loops, and its outcome in the last step's `OUTCOMES`.
   - `.github/workflows/collect-<city>.yaml`: copy another city's manual workflow (no schedule).
   - `.github/workflows/export-events.yaml`: add `--also-config config/app-<city>.yaml` and the new
     workflow's name under `workflow_run`.
5. `config/little-outings.yaml`: add the city to `other_events_cities`.
6. Check: `uv run cityklub config validate --config config/app-<city>.yaml`,
   `uv run cityklub collect-all --config config/app-<city>.yaml --storage local`, `uv run pytest`,
   `uv run ruff check .` and `uv run ruff format --check .`.

## 2. Places: spikinglabs/osm-family-data

Add the town with its centre to the places towns list (`radius_m` 10000 for a big city, otherwise the
default). If it is already under `more_towns` (the places-only towns: every city of 100,000 or more),
move it from there to `towns`. After merging, start a manual Places run with only the new area ticked.
Toilets use the same towns.

## 3. Site: spikinglabs/little-outings (this repo)

1. `content/regions/bergisches-land.yaml`: the town with `lat`, `lon`, `en` and `zh` names (the
   town picker, search and the map read it).
2. `scripts/translate.mjs`: add the city to the prompt's list of towns, with its standard Chinese name.
3. `functions/mcp.ts`: add the city to `INSTRUCTIONS`, so AI assistants know it is covered.
4. `scripts/fetch-holidays.mjs`: add the state to `STATES` if it is new, then
   `npm run fetch:holidays` and commit `data/school-holidays.json`.
5. Check: `npm test`, `npm run check`, `npm run build`. The deploy job's "Files" notice must stay
   well under 20,000. Event and place pages don't count (they are packed, see `src/lib/page-packs.ts`).

## 4. First night

1. Merge cityklub-event-data first. Then run **Collect <City> events** once by hand, which also
   starts the export.
2. The next Translate run sorts the new titles with AI. A new city brings a one-off batch of a few
   thousand, capped per night by `SORT_LIMIT`. Look at **Check these** in the admin for the unsure ones.
3. Merge little-outings, and open the new town on the live site: Discover, the map, and an event page
   in DE, EN and ZH.
4. Note the city and its PRs in the project memory, so later threads know it is covered.
