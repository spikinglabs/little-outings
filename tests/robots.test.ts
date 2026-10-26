import { test } from "node:test";
import assert from "node:assert/strict";
import { robotsTxt } from "../src/lib/seo.ts";

// The longest matching rule wins, Allow on a tie (RFC 9309), with * and $ as Google and Bing read them.
function allowed(txt: string, agent: string, path: string) {
  const groups = txt.split(/\n\n/).map((g) => g.split("\n").filter(Boolean));
  const mine = groups.find((g) => g.some((l) => l === `User-agent: ${agent}`)) ?? groups.find((g) => g.includes("User-agent: *"))!;
  let best = { len: -1, allow: true };
  for (const l of mine) {
    const m = l.match(/^(Allow|Disallow): (.*)$/);
    if (!m) continue;
    const re = new RegExp("^" + m[2].replace(/[.?+]/g, "\\$&").replace(/\*/g, ".*"));
    if (re.test(path) && (m[2].length > best.len || (m[2].length === best.len && m[1] === "Allow"))) best = { len: m[2].length, allow: m[1] === "Allow" };
  }
  return best.allow;
}

test("training crawlers see the front doors only; everyone else sees every page", () => {
  const txt = robotsTxt("https://outings.allo.land", ["weihnachtsmaerkte", "karneval"]);
  for (const p of ["/", "/llms.txt", "/zh/", "/en/wochenende/koeln/", "/de/weihnachtsmaerkte/", "/en/karneval/koeln/", "/en/daten/"]) assert.ok(allowed(txt, "GPTBot", p), p);
  for (const p of ["/en/orte/osm-node-1/", "/de/termine/x/", "/api/v1/places.json", "/en/karte/"]) assert.ok(!allowed(txt, "GPTBot", p), p);
  for (const p of ["/en/orte/osm-node-1/", "/api/v1/places.json"]) assert.ok(allowed(txt, "OAI-SearchBot", p), p);
  assert.ok(allowed(txt, "Baiduspider", "/zh/orte/x/"));
  assert.ok(!allowed(txt, "Bingbot", "/admin/"));
  assert.match(txt, /Sitemap: https:\/\/outings.allo.land\/sitemap.xml/);
});
