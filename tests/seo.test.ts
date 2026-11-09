import { test } from "node:test";
import assert from "node:assert/strict";
import { eventsSoon, sitemapWorthy } from "../src/lib/seo.ts";
import type { Place } from "../src/lib/types.ts";

const place = (extra: Partial<Place> = {}) =>
  ({ type: "place", id: "osm-node-1", name: "Spielplatz", kind: "playground", geo: { precision: "exact" }, facilities: {}, quotes: [], trust: { level: "community" }, ...extra }) as unknown as Place;
const fac = (status: "yes" | "no" | "unknown") => ({ status, confirmed: 0 });

test("the sitemap skips name-only places and keeps ones with something of their own", () => {
  assert.equal(sitemapWorthy(place()), false);
  assert.equal(sitemapWorthy(place({ facilities: { toilet: fac("yes"), shade: fac("unknown") } })), false);
  assert.equal(sitemapWorthy(place({ facilities: { toilet: fac("yes"), shade: fac("no") } })), true);
  assert.equal(sitemapWorthy(place({ website: "https://x.de" })), true);
  assert.equal(sitemapWorthy(place({ hours: "Mo-Fr 10-17" })), true);
  assert.equal(sitemapWorthy(place({ tips: [{ topic: "x", text: "y" }] })), true);
  assert.equal(sitemapWorthy(place({ trust: { level: "verified" } })), true);
});

test("the sitemap lists events of the next two weeks and ones already running", () => {
  const ev = (start: string, end = start) => ({ start, end });
  const got = eventsSoon([ev("2026-11-09"), ev("2026-11-23"), ev("2026-11-24"), ev("2026-10-01", "2026-12-31"), ev("2026-11-01", "2026-11-08")], "2026-11-09");
  assert.deepEqual(got, [ev("2026-11-09"), ev("2026-11-23"), ev("2026-10-01", "2026-12-31")]);
});
