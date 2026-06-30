interface CacheEntry {
  value:     unknown
  expiresAt: number
}

export class SimpleCache {
  private store = new Map<string, CacheEntry>()

  get(key: string): unknown | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: unknown, ttlMs = 30000): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    })
  }

  invalidate(key: string): void {
    this.store.delete(key)
  }

  invalidatePattern(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key)
      }
    }
  }
}

export const cache = new SimpleCache()
