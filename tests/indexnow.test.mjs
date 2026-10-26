import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { KEY, sitemapUrls, toSend } from "../scripts/indexnow.mjs";

const xml = `<urlset><url><loc>https://outings.allo.land/de/</loc><lastmod>2026-10-20</lastmod></url>
<url><loc>https://outings.allo.land/en/orte/a/</loc></url>
<url><loc>https://outings.allo.land/en/orte/b/</loc></url>
<url><loc>https://outings.allo.land/zh/wochenende/koeln/</loc></url>
<url><loc>https://outings.allo.land/en/daten/</loc><lastmod>2026-10-26</lastmod></url></urlset>`;

test("IndexNow sends new URLs, pages that change on their own, and today's changes", () => {
  const urls = sitemapUrls(xml);
  assert.equal(urls.length, 5);
  const sent = new Set(urls.map((u) => u.loc).filter((u) => !u.endsWith("/b/")));
  assert.deepEqual(toSend(urls, sent, "2026-10-26"), [
    "https://outings.allo.land/de/",
    "https://outings.allo.land/en/orte/b/",
    "https://outings.allo.land/zh/wochenende/koeln/",
    "https://outings.allo.land/en/daten/",
  ]);
  assert.equal(toSend(urls, new Set(), "2026-10-26").length, 5); // first run: everything
});

test("the IndexNow key file is published with the key in it", () => {
  assert.ok(existsSync(`public/${KEY}.txt`));
  assert.equal(readFileSync(`public/${KEY}.txt`, "utf8").trim(), KEY);
});
