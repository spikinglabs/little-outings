// When a season's chip shows. Its own file because Discover's script runs it in the browser,
// where seasons.ts (which reads files) can't go.
export type Window = { from: string; to: string };

/** True when `today` (YYYY-MM-DD) is inside one of the windows. "MM-DD" windows repeat yearly and may run over New Year. */
export function inWindow(windows: Window[], today: string): boolean {
  return windows.some(({ from, to }) => {
    if (from.length === 10) return today >= from && today <= to;
    const md = today.slice(5);
    return from <= to ? md >= from && md <= to : md >= from || md <= to;
  });
}
