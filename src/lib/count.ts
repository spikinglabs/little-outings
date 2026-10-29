// Adds one to an anonymous daily total (see functions/api/hit.ts): no id, no cookie, nothing stored here.
// Buttons and links can also carry data-count="<action>"; app.ts counts their clicks.
// from_rednote: a code from a Rednote card or a share card typed into the search box (src/scripts/explore.ts).
// from_wechat: a visit opened inside WeChat, counted once per visit (src/scripts/app.ts).
// share_image: an event or place shared or saved as a picture; rednote_share also counts its Rednote button.
export type CountAction = "save" | "maps" | "calendar" | "website" | "share" | "install" | "copy" | "from_rednote" | "from_wechat" | "share_image" | "rednote_share";

export function count(e: CountAction, about?: "event" | "place") {
  const path = location.pathname;
  const on = about ?? (/\/termine\//.test(path) ? "event" : /\/orte\//.test(path) ? "place" : "other");
  const body = JSON.stringify({ e, on, lang: document.documentElement.lang.slice(0, 2) });
  try {
    if (!navigator.sendBeacon?.("/api/hit", body)) fetch("/api/hit", { method: "POST", body, keepalive: true }).catch(() => {});
  } catch { /* counting must never get in the way */ }
}
