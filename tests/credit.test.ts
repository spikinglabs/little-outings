import { test } from "node:test";
import assert from "node:assert/strict";
import { tagSharedNames } from "../src/lib/credit.ts";

test("a nickname two families use gets a short tag; one family's name stays plain", () => {
  const items = [
    { by: "Allo.Land", byId: "3f2a9c01" },
    { by: "allo.land", byId: "b7e40d22" },
    { by: "Allo.Land", byId: "3f2a9c01" },
    { by: "Brave Hedgehog", byId: "11112222" },
    { by: "Brave Hedgehog", byId: "11112222" },
    { by: "Allo.Land" }, // sent before ids existed
    {},
  ];
  tagSharedNames(items);
  assert.deepEqual(items.map((x) => x.by), ["Allo.Land #3f2a", "allo.land #b7e4", "Allo.Land #3f2a", "Brave Hedgehog", "Brave Hedgehog", "Allo.Land", undefined]);
});
