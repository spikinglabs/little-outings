import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPosts, postJson, postVideo, readPosts } from "../scripts/posts.mts";
import { checkVideo, scenesFromCards, timeline, videoPage } from "../src/lib/video.ts";

const fonts = { regular: "file:///r.ttf", bold: "file:///b.ttf" };

test("every post makes a video of a sensible length", () => {
  for (const p of readPosts()) {
    const { duration, html } = videoPage(postVideo(p), fonts);
    assert.ok(duration >= 10 && duration <= 60, `${p.code}: ${duration} s`);
    assert.match(html, /window\.render = render/);
  }
});

test("the Frankfurt post keeps the sample's scenes, about half a minute", () => {
  const p = readPosts().find((p) => p.code === "FA5E")!;
  assert.ok(p.video, "has its own video block");
  const v = postVideo(p);
  assert.equal(v.snow, true);
  assert.equal(v.scenes.at(-1)!.vote!.length, 6);
  const { duration } = videoPage(v, fonts);
  assert.ok(duration >= 25 && duration <= 35, `${duration} s`);
});

test("a vote card becomes the vote scene, other cards keep their tag and lines", () => {
  const scenes = scenesFromCards([
    { tone: "gold", title: "Cover\nhook", big: true, lines: ["why"] },
    { tone: "mint", tag: "A", title: "One", lines: ["a line"], note: "a note" },
    { tone: "ink", title: "Which?", rows: [{ when: "A", name: "one" }, { when: "B", name: "two" }], search: "小鹿出游" },
  ]);
  assert.equal(scenes[0].hook, true);
  assert.equal(scenes[0].sub, "why");
  assert.equal(scenes[1].tone, "green");
  assert.deepEqual(scenes[1].items, [{ v: "a line" }]);
  assert.equal(scenes[1].sub, "a note");
  assert.deepEqual(scenes[2].vote, [{ letter: "A", name: "one" }, { letter: "B", name: "two" }]);
  assert.equal(scenes[2].search, "小鹿出游");
});

test("a scene stays long enough to read but never drags", () => {
  assert.equal(timeline({ title: "Hi" }).seconds, 3);
  assert.equal(timeline({ title: "x", items: Array.from({ length: 12 }, () => ({ v: "很长很长的一句话".repeat(4) })) }).seconds, 5);
  assert.equal(timeline({ title: "x", seconds: 4.2 }).seconds, 4.2);
});

test("text is escaped in the page", () => {
  const { html } = videoPage({ scenes: [{ title: "<b>&" }] }, fonts);
  assert.match(html, /&lt;b&gt;&amp;/);
  assert.doesNotMatch(html, /<h2[^>]*><b>/);
});

test("a broken video block fails the check", () => {
  assert.deepEqual(checkVideo({ scenes: [] }), ["video: needs scenes"]);
  assert.match(checkVideo({ scenes: [{ tone: "pink", title: "x" }] })[0], /tone must be one of/);
  assert.match(checkVideo({ scenes: [{ tone: "red" }] })[0], /nothing to show/);
  assert.match(checkVideo({ scenes: [{ vote: [{ letter: "G", name: "x" }] }] })[0], /A to F/);
  const p = { ...readPosts()[0], video: { scenes: [] } };
  assert.ok(checkPosts([p]).some((m) => m.includes("video: needs scenes")));
});

test("post.json names the video only when there is one", () => {
  const p = readPosts()[0];
  assert.equal(postJson(p, "2026-11-13T10:00:00Z").video, undefined);
  assert.equal(postJson(p, "2026-11-13T10:00:00Z", `${p.id}.mp4`).video, `${p.id}.mp4`);
});
