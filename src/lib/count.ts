// Adds one to an anonymous daily total (see functions/api/hit.ts): no id, no cookie, nothing stored here.
// Buttons and links can also carry data-count="<action>"; app.ts counts their clicks.
// from_rednote: a code from a Rednote card or a share card typed into the search box (src/scripts/explore.ts).
// from_wechat: a visit opened inside WeChat, counted once per visit (src/scripts/app.ts).
// share_image: an event or place shared or saved as a picture; rednote_share also counts its Rednote button.
export type CountAction = "save" | "maps" | "calendar" | "website" | "share" | "install" | "copy" | "from_rednote" | "from_wechat" | "share_image" | "rednote_share";

/**
 * Also adds one to the shared Allo usage counter (monitoring.admin.allo.land, spikinglabs/alloland-rebirth
 * workers/count), which keeps only day, site, feature and country, so every Allo site shows in one
 * place. Skipped when the browser asks not to be tracked, and off outings.allo.land.
 */
export function track(feature: string) {
  try {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.doNotTrack === "1" || nav.globalPrivacyControl) return;
    if (location.hostname !== "outings.allo.land") return;
    nav.sendBeacon?.(`https://monitoring.admin.allo.land/e?f=${encodeURIComponent(feature)}`);
  } catch { /* counting must never get in the way */ }
}

// Runs fn once a person is plausibly there: after the page has been visible for 3 seconds,
// or at the first tap, click, key or scroll. Scripts that load the page and leave aren't counted.
export function whenPresent(fn: () => void) {
  const events = ["pointerdown", "keydown", "scroll", "touchstart"];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onVisibility = () => {
    clearTimeout(timer);
    if (document.visibilityState === "visible") timer = setTimeout(go, 3000);
  };
  function go() {
    clearTimeout(timer);
    for (const e of events) removeEventListener(e, go, true);
    document.removeEventListener("visibilitychange", onVisibility);
    fn();
  }
  for (const e of events) addEventListener(e, go, { capture: true, passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  onVisibility();
}

export function count(e: CountAction, about?: "event" | "place") {
  track(e);
  const path = location.pathname;
  const on = about ?? (/\/termine\//.test(path) ? "event" : /\/orte\//.test(path) ? "place" : "other");
  const body = JSON.stringify({ e, on, lang: document.documentElement.lang.slice(0, 2) });
  try {
    if (!navigator.sendBeacon?.("/api/hit", body)) fetch("/api/hit", { method: "POST", body, keepalive: true }).catch(() => {});
  } catch { /* counting must never get in the way */ }
}
