import { cardsHandler } from "../../lib/cards.js";

// Instagram sets: the cards and captions the site's build drew (/ig/index.json, src/lib/instagram.ts).
export const onRequestGet = cardsHandler({ dir: "ig", ext: "jpg", type: "image/jpeg", label: "Instagram" });
