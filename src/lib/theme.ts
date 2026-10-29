// Light or dark, kept in this browser only (lo-theme), like a device setting.
// The head script in Base.astro applies it before the page paints; this is used when it changes.
export type ThemeChoice = "auto" | "light" | "dark";
const LIGHT = "#ffcc00", DARK = "#121314";

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  try { choice === "auto" ? localStorage.removeItem("lo-theme") : localStorage.setItem("lo-theme", choice); } catch { /* private mode: this page only */ }
  if (choice === "auto") {
    delete root.dataset.theme;
    metas.forEach((m) => (m.content = m.media.includes("dark") ? DARK : LIGHT));
  } else {
    root.dataset.theme = choice;
    metas.forEach((m) => (m.content = choice === "dark" ? DARK : LIGHT));
  }
  document.dispatchEvent(new CustomEvent("lo:theme", { detail: choice }));
}

export const themeChoice = (): ThemeChoice => (document.documentElement.dataset.theme as ThemeChoice | undefined) ?? "auto";

/** Whether the page shows dark right now, from the chosen theme or else the phone's setting. */
export const isDark = () => {
  const c = themeChoice();
  return c === "auto" ? matchMedia("(prefers-color-scheme: dark)").matches : c === "dark";
};
