'use client'

import type { SupplierBalance } from '@/types'
import { cache } from '@/lib/cache'
import { useCachedFetch } from '@/hooks/use-cached-fetch'

const LIST_TTL = 15000

export function useSuppliers() {
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
    const res = await window.fetch('/api/suppliers', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error ?? 'Failed to create supplier')
    cache.invalidatePattern('/api/suppliers')
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
    const res = await window.fetch(`/api/suppliers/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error ?? 'Failed to update supplier')
    cache.invalidatePattern('/api/suppliers')
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
