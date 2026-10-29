// The share card code of every event and place page (src/lib/rednote-code.ts), worked out once per build.
import { getData } from "./data";
import { itemCodes } from "./rednote-code";

let cache: Promise<Map<string, string>> | undefined;

/** Code per page path without the language: "termine/<id>/" or "orte/<id>/". */
export const pageCodes = () => (cache ??= getData().then(({ events, places }) =>
  itemCodes([...events.map((e) => `termine/${e.id}/`), ...places.map((p) => `orte/${p.id}/`)])));
