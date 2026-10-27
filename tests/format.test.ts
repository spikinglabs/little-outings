import { test } from "node:test";
import assert from "node:assert/strict";
import { latinRuns } from "../src/lib/format.ts";

test("German words in Chinese headings are marked so phones can hyphenate them", () => {
  assert.deepEqual(latinRuns("Krewelshof Lohmar 儿童跳蚤市场", "zh"), [{ s: "Krewelshof Lohmar", de: true }, { s: " 儿童跳蚤市场" }]);
  assert.deepEqual(latinRuns("科隆 Zoo 动物园", "zh"), [{ s: "科隆 " }, { s: "Zoo", de: true }, { s: " 动物园" }]);
  assert.deepEqual(latinRuns("Kinderflohmarkt im Krewelshof", "de"), [{ s: "Kinderflohmarkt im Krewelshof" }]);
  assert.equal(latinRuns("Mäuse & Co. 2026 亲子", "zh").map((r) => r.s).join(""), "Mäuse & Co. 2026 亲子");
});
