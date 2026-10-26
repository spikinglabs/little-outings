/**
 * Runs `fn` over `items`, at most `limit` at a time, in order of start. Stops starting new items once
 * `fn` returns false (items already running finish). The nightly scripts mostly wait on web pages and
 * the model, so a few at once cuts the Actions minutes they use without asking any server much harder.
 */
export async function eachLimit<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<boolean | void>): Promise<void> {
  let next = 0;
  let stop = false;
  const worker = async () => {
    while (!stop && next < items.length) {
      const i = next++;
      if ((await fn(items[i], i)) === false) stop = true;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
