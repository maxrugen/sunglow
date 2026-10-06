/**
 * Small in-memory cache with a TTL and a size cap. Serverless instances are
 * short-lived, but a warm one could otherwise grow without limit when callers
 * vary the key (coordinates, flight times).
 */
export class BoundedCache<T> {
  private entries = new Map<string, { ts: number; value: T }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      // Maps iterate in insertion order, so the first key is the oldest.
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { ts: Date.now(), value });
  }

  get size(): number {
    return this.entries.size;
  }
}
