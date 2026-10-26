/**
 * Events that run for a week or more (exhibitions, festival fortnights) are on any day, so they
 * don't belong at the top of "this weekend", where the oldest start date would put them. Discover
 * lists them after the events that happen only then (lib/order.ts); in their last week they keep their place as a "Last chance".
 */
export const RUN_DAYS = 7;

const day = (s: string) => Date.parse(`${s.slice(0, 10)}T12:00:00Z`) / 864e5;

/** Whether an event from `start` to `end` ("YYYY-MM-DD") lasts a week or more. */
export const runsLong = (start: string, end: string) => day(end) - day(start) >= RUN_DAYS;

/** Whether a long-running event ends within the coming week, counting `today`. */
export const lastChance = (end: string, today: string) => day(end) - day(today) < RUN_DAYS;

