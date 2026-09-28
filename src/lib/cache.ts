export interface CacheScope {
  userId: string
  tenantId: string
}

export function createCacheScope(
  userId: string | null | undefined,
  tenantId: string | null | undefined,
): CacheScope | null {
  return userId && tenantId ? { userId, tenantId } : null
}

interface CacheEntry {
  value:     unknown
  expiresAt: number
}

export class SimpleCache {
  private store = new Map<string, Map<string, Map<string, CacheEntry>>>()

  private entries(scope: CacheScope, create = false): Map<string, CacheEntry> | undefined {
    if (!scope.userId || !scope.tenantId) return undefined

    let tenants = this.store.get(scope.userId)
    if (!tenants && create) {
      tenants = new Map()
      this.store.set(scope.userId, tenants)
    }

    let entries = tenants?.get(scope.tenantId)
    if (!entries && create) {
      entries = new Map()
      tenants?.set(scope.tenantId, entries)
    }
    return entries
  }

  get(scope: CacheScope, key: string): unknown | undefined {
    const entries = this.entries(scope)
    const entry = entries?.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      entries?.delete(key)
      return undefined
    }
    return entry.value
  }

  set(scope: CacheScope, key: string, value: unknown, ttlMs = 30000): void {
    this.entries(scope, true)?.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    })
  }

  invalidate(scope: CacheScope, key: string): void {
    this.entries(scope)?.delete(key)
  }

  invalidatePattern(scope: CacheScope, prefix: string): void {
    const entries = this.entries(scope)
    if (!entries) return

    for (const key of entries.keys()) {
      if (key.startsWith(prefix)) {
        entries.delete(key)
      }
    }
  }

  clear(): void {
    this.store.clear()
  }
}

export const cache = new SimpleCache()
