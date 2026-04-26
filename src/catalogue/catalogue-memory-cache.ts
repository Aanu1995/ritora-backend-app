type TimedCacheEntry<T> = {
  expiresAt: number;
  value: Promise<T>;
};

type TimedMemoryCacheOptions<T> = {
  ttlMs: number;
  maxEntries: number;
  shouldCacheValue?: (value: T) => boolean;
};

export class TimedMemoryCache<T> {
  private readonly entries = new Map<string, TimedCacheEntry<T>>();

  constructor(private readonly options: TimedMemoryCacheOptions<T>) {}

  getOrCreate(key: string, factory: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > now) {
      return existing.value;
    }

    if (existing) {
      this.entries.delete(key);
    }

    const value = factory()
      .then((result) => {
        if (
          this.options.shouldCacheValue &&
          !this.options.shouldCacheValue(result)
        ) {
          this.entries.delete(key);
        }

        return result;
      })
      .catch((error) => {
        this.entries.delete(key);
        throw error;
      });

    this.entries.set(key, {
      expiresAt: now + this.options.ttlMs,
      value,
    });
    this.evict(now);
    return value;
  }

  private evict(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }

    while (this.entries.size > this.options.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) {
        return;
      }

      this.entries.delete(oldestKey);
    }
  }
}
