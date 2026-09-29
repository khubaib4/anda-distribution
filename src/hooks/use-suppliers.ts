'use client'

import type { SupplierBalance } from '@/types'
import { cache, createCacheScope } from '@/lib/cache'
import { useCachedFetch } from '@/hooks/use-cached-fetch'
import { useTenantFetch } from '@/hooks/use-tenant-fetch'
import { useTenant } from '@/lib/tenant-client'

const LIST_TTL = 15000

export function useSuppliers() {
  const { userId, tenantId } = useTenant()
  const tenantFetch = useTenantFetch()
  const { data, loading, error, refetch } = useCachedFetch<SupplierBalance[]>(
    '/api/suppliers',
    { ttl: LIST_TTL },
  )

  async function createSupplier(payload: {
    name:     string
    phone?:   string
    address?: string
    notes?:   string
  }) {
    const mutationScope = createCacheScope(userId, tenantId)
    const res = await tenantFetch('/api/suppliers', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error ?? 'Failed to create supplier')
    if (mutationScope) cache.invalidatePattern(mutationScope, '/api/suppliers')
    await refetch()
    return result
  }

  async function updateSupplier(
    id: string,
    payload: Partial<{
      name:      string
      phone:     string
      address:   string
      notes:     string
      is_active: boolean
    }>,
  ) {
    const mutationScope = createCacheScope(userId, tenantId)
    const res = await tenantFetch(`/api/suppliers/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error ?? 'Failed to update supplier')
    if (mutationScope) cache.invalidatePattern(mutationScope, '/api/suppliers')
    await refetch()
    return result
  }

  return {
    suppliers: data ?? [],
    loading,
    error,
    refetch,
    createSupplier,
    updateSupplier,
  }
}
