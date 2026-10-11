// Adds one to an anonymous daily total (see functions/api/hit.ts): no id, no cookie, nothing stored here.
// Buttons and links can also carry data-count="<action>"; app.ts counts their clicks.
export type CountAction = "save" | "maps" | "calendar" | "website" | "share" | "install";

export function count(e: CountAction) {
  const path = location.pathname;
  const on = /\/termine\//.test(path) ? "event" : /\/orte\//.test(path) ? "place" : "other";
  const body = JSON.stringify({ e, on, lang: document.documentElement.lang.slice(0, 2) });
  try {
    if (!navigator.sendBeacon?.("/api/hit", body)) fetch("/api/hit", { method: "POST", body, keepalive: true }).catch(() => {});
  } catch { /* counting must never get in the way */ }
}
