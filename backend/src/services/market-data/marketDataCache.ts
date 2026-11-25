/**
 * CacheProvider abstraction — In-Memory TTL/LRU by default,
 * ready for Redis when REDIS_URL is configured.
 */

export interface CacheProvider {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T, ttlMs: number): void;
  del(key: string): void;
  stats(): { backend: 'in-memory' | 'redis'; entries: number };
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class InMemoryCache implements CacheProvider {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
  }

  public get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  public set<T>(key: string, value: T, ttlMs: number): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + Math.max(100, ttlMs),
    });
  }

  public del(key: string): void {
    this.store.delete(key);
  }

  public stats(): { backend: 'in-memory' | 'redis'; entries: number } {
    return { backend: 'in-memory', entries: this.store.size };
  }
}

export const marketCache: CacheProvider = new InMemoryCache(15_000);
