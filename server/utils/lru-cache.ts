/**
 * Simple TTL-aware LRU cache using a Map.
 *
 * Map preserves insertion order; on access we delete-then-re-insert
 * to move the entry to the "newest" position. Eviction removes the
 * first (oldest-accessed) key — true LRU, not FIFO.
 *
 * Replaces the FIFO pattern (Map.keys().next()) used in 4+ places.
 */

export interface LruCacheOptions {
  /** Maximum number of entries */
  maxSize: number;
  /** TTL in milliseconds (entries expire after this duration) */
  ttlMs: number;
  /** Optional cleanup callback when an entry is evicted */
  onEvict?: (key: string, value: unknown) => void;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class LruCache<T> {
  private readonly map = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly onEvict?: (key: string, value: unknown) => void;

  constructor(opts: LruCacheOptions) {
    this.maxSize = opts.maxSize;
    this.ttlMs = opts.ttlMs;
    this.onEvict = opts.onEvict;
  }

  /** Get a value, returning undefined if missing or expired. Refreshes LRU position. */
  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Move to end (most recently used) by delete + re-insert
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  /** Set a value. Evicts the least-recently-used entry if at capacity. */
  set(key: string, value: T): void {
    // If key already exists, delete first to refresh position
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Evict the least recently used (first entry in Map iteration order)
      const lruKey = this.map.keys().next().value;
      if (lruKey !== undefined) {
        const evicted = this.map.get(lruKey);
        this.map.delete(lruKey);
        if (this.onEvict && evicted) {
          this.onEvict(lruKey, evicted.value);
        }
      }
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /** Check if key exists and is not expired. */
  has(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  /** Delete a specific key. */
  delete(key: string): boolean {
    return this.map.delete(key);
  }

  /** Current number of entries (including potentially expired ones). */
  get size(): number {
    return this.map.size;
  }

  /** Prune all expired entries. Call periodically if needed. */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of Array.from(this.map)) {
      if (now > entry.expiresAt) this.map.delete(key);
    }
  }
}
