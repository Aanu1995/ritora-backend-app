/**
 * Run `worker` over every item with at most `concurrency` invocations in
 * flight at once. Rejections are not short-circuited; each item is attempted
 * and the settled results are returned in input order.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  const limit = Math.max(1, Math.floor(concurrency));
  let nextIndex = 0;

  async function runLane(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = {
          status: 'fulfilled',
          value: await worker(items[index]),
        };
      } catch (reason: unknown) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runLane()),
  );
  return results;
}
