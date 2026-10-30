import { cardsHandler } from "../../lib/cards.js";

// Rednote (小红书) sets: the cards and captions the site's build drew (/xhs/index.json, src/lib/rednote.ts).
export const onRequestGet = cardsHandler({ dir: "xhs", ext: "png", type: "image/png", label: "Rednote" });
