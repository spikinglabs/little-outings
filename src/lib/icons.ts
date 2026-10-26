// Line icons on a 24px grid, drawn with currentColor. Same set as the design kit.
export const KIND_ICON: Record<string, string> = {
  farm: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  cafe: '<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10h2a2.5 2.5 0 0 1 0 5h-2"/><path d="M8 3v3M12 3v3"/>',
  playground: '<path d="M4 21 9 5h6l5 16"/><path d="M7 13h10"/>',
  museum: '<path d="M3 9 12 4l9 5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
  pool: '<path d="M3 17c2 0 2-1.5 4.5-1.5S10 17 12 17s2.5-1.5 4.5-1.5S19 17 21 17"/><path d="M3 21c2 0 2-1.5 4.5-1.5S10 21 12 21s2.5-1.5 4.5-1.5S19 21 21 21"/><path d="M8 14V5a2 2 0 0 1 4 0M16 14V5"/>',
  park: '<path d="M12 3 6 13h4l-3 5h10l-3-5h4z"/><path d="M12 18v3"/>',
  indoor: '<rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/><rect x="8.5" y="4" width="7" height="7" rx="1"/>',
  fun: '<circle cx="12" cy="10" r="6"/><path d="M12 4v12M6 10h12M8 21l4-5 4 5"/>',
  zoo: '<path d="M7 20V9a5 5 0 0 1 10 0v11"/><path d="M4 20h16"/><path d="M10 9v11M14 9v11"/>',
  winter: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>',
};

export const FEATURE_ICON: Record<string, string> = {
  playground: '<path d="M5 21V7h4v14"/><path d="M9 8l10 13"/><path d="M5 12h4M5 16h4"/>',
  changing_table: '<path d="M3 13h18"/><path d="M5 13v7M19 13v7"/><circle cx="8" cy="9" r="2"/><path d="M11 10.5h7"/>',
  highchairs: '<path d="M8 3v9h9"/><path d="M8 12l-2 9M17 12l2 9M9.5 17h6"/>',
  kids_menu: '<path d="M7 3v7a2 2 0 0 0 4 0V3M9 12v9"/><path d="M17 3c-2 0-3 2.2-3 5s1 4 3 4v9"/>',
  toys: '<circle cx="12" cy="14" r="6"/><circle cx="7" cy="7" r="2.2"/><circle cx="17" cy="7" r="2.2"/><path d="M10 13h.01M14 13h.01M10.5 16.5c1 .7 2 .7 3 0"/>',
  animals: '<circle cx="6.5" cy="10" r="1.7"/><circle cx="10" cy="6" r="1.7"/><circle cx="14" cy="6" r="1.7"/><circle cx="17.5" cy="10" r="1.7"/><path d="M8 17c0-3 2-5 4-5s4 2 4 5-2 3-4 3-4 0-4-3z"/>',
  stroller_friendly: '<path d="M3 5h3l2.5 9H19a6 6 0 0 0-6-8h-1v8"/><circle cx="9" cy="19" r="1.8"/><circle cx="17" cy="19" r="1.8"/>',
  nursing_room: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  indoor_play: '<rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/><rect x="8.5" y="4.5" width="7" height="7" rx="1"/>',
  toilets: '<path d="M7 4v16M17 4v16M4 9h6M14 9h6"/>',
  farm_shop: '<path d="M4 9h16l-1.5 11h-13z"/><path d="M8 9l4-5 4 5"/>',
  parking: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M10 16V8h3a2.5 2.5 0 0 1 0 5h-3"/>',
  sandpit: '<path d="M3 20h18"/><path d="M5 11h8l-1.2 6H6.2z"/><path d="M6 11c0-1.7 1.4-3 3-3s3 1.3 3 3"/><path d="M18 4v9M16.3 13h3.4L18 17z"/>',
  water_play: '<path d="M12 3c3 4.4 5 7.2 5 9.8a5 5 0 0 1-10 0C7 10.2 9 7.4 12 3z"/><path d="M3 21c2 0 2-1.5 4.5-1.5S10 21 12 21s2.5-1.5 4.5-1.5S19 21 21 21"/>',
  swings: '<path d="M3 4h18M5 4l-1 17M19 4l1 17"/><path d="M9 4v11M15 4v11M8 15h8"/>',
  slides: '<path d="M5 21V5"/><path d="M5 5h3l9 14h4"/><path d="M5 10h4M5 15h4"/>',
  climbing: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="9" cy="7.5" r="1.2"/><circle cx="15" cy="10.5" r="1.2"/><circle cx="9.5" cy="14" r="1.2"/><circle cx="14.5" cy="17.5" r="1.2"/>',
  toddler_area: '<circle cx="12" cy="6.5" r="3"/><path d="M7 21c0-4.5 2.2-8 5-8s5 3.5 5 8"/><path d="M9.5 16.5h5"/>',
  shade: '<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v7a2 2 0 0 1-4 0"/>',
  benches: '<path d="M4 9h16M4 13h16"/><path d="M6 13v6M18 13v6M6 9v4M18 9v4"/>',
  fenced: '<path d="M5 21V7l2-3 2 3v14M15 21V7l2-3 2 3v14"/><path d="M3 11h18M3 17h18"/>',
};

export const UI_ICON: Record<string, string> = {
  explore: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  saved: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  mine: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>',
  add: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  locate: '<circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  water: '<path d="M12 3c3 4.4 5 7.2 5 9.8a5 5 0 0 1-10 0C7 10.2 9 7.4 12 3z"/>',
  brand: '<path d="M4 18c3-6 6-9 8-9s5 3 8 9"/><circle cx="12" cy="5" r="2"/><path d="M2 20h20"/>',
};

export const svg = (body: string, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

// Cards repeat the same icons thousands of times, so they reference one hidden sprite
// (rendered once by Base.astro) instead of inlining every path.
const SETS: Record<string, Record<string, string>> = { k: KIND_ICON, f: FEATURE_ICON, u: UI_ICON };
export const sprite = () =>
  `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${Object.entries(SETS)
    .flatMap(([p, set]) => Object.entries(set).map(([k, body]) => `<symbol id="${p}-${k}">${body}</symbol>`))
    .join("")}</svg>`;
/** An icon from the sprite: set "k" (kinds), "f" (features) or "u" (UI). */
/** Styled by the .ic rule in global.css, so each copy stays short. */
export const icon = (set: "k" | "f" | "u", key: string) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><use href="#${set}-${key}"/></svg>`;
