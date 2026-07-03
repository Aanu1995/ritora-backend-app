import { mapWithConcurrency } from './concurrency';

describe('mapWithConcurrency', () => {
  it('processes every item and preserves input order', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await mapWithConcurrency(items, 2, (item) =>
      Promise.resolve(item * 10),
    );

    expect(results).toEqual(
      items.map((item) => ({ status: 'fulfilled', value: item * 10 })),
    );
  });

  it('captures rejections without aborting the remaining items', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, (item) => {
      if (item === 2) {
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve(item);
    });

    expect(results[0]).toEqual({ status: 'fulfilled', value: 1 });
    expect(results[1].status).toBe('rejected');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 3 });
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('handles empty input and clamps invalid concurrency values', async () => {
    expect(await mapWithConcurrency([], 4, () => Promise.resolve(1))).toEqual(
      [],
    );

    const results = await mapWithConcurrency([1, 2], 0, (item) =>
      Promise.resolve(item),
    );
    expect(results).toEqual([
      { status: 'fulfilled', value: 1 },
      { status: 'fulfilled', value: 2 },
    ]);
  });
});
