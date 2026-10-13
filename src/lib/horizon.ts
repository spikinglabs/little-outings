/**
 * How far ahead events are shown and built: today plus 13 days, Discover's longest "When"
 * choice. The import skips events starting later (Cloudflare Pages takes at most 20,000 files),
 * and the nightly rebuild brings them in as they come within reach.
 */
export const DAYS_AHEAD = 14;

/** The last day ("YYYY-MM-DD") events are shown and built for, counting from `today`. */
export function lastDay(today: string): string {
  return new Date(Date.parse(`${today}T12:00:00Z`) + (DAYS_AHEAD - 1) * 864e5).toISOString().slice(0, 10);
}
