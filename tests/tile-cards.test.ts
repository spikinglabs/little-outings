import { test } from "node:test";
import assert from "node:assert/strict";
import { cardsIn, dataOf } from "../src/lib/tile-cards.ts";

const tile = `<!DOCTYPE html><article class="item" hidden data-id="ck-1" data-type="event" data-long="1" data-q="café zettel&#39;s traum &amp; co" data-tip-x="a"><div class="meta">Café &gt; Bar</div></article>`
  + `<article class="item" hidden data-id="osm-2" data-type="place" data-kind="playground" data-farm><h3>Spielplatz</h3></article>`;

test("a tile splits into its cards", () => {
  const cards = cardsIn(tile);
  assert.equal(cards.length, 2);
  assert.ok(cards[0].startsWith('<article class="item" hidden data-id="ck-1"'));
  assert.ok(cards[0].endsWith("</article>"));
  assert.ok(cards[1].includes("Spielplatz"));
  assert.deepEqual(cardsIn("<!DOCTYPE html>"), []);
});

test("data attributes read like el.dataset", () => {
  const [a, b] = cardsIn(tile).map(dataOf);
  assert.deepEqual(a, { id: "ck-1", type: "event", long: "1", q: "café zettel's traum & co", tipX: "a" });
  assert.deepEqual(b, { id: "osm-2", type: "place", kind: "playground", farm: "" });
});
