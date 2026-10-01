'use client'

import { useMemo } from 'react'
import type { CustomerBalance } from '@/types'
import { cache, createCacheScope } from '@/lib/cache'
import { useCachedFetch } from '@/hooks/use-cached-fetch'
import { useTenantFetch } from '@/hooks/use-tenant-fetch'
import { useTenant } from '@/lib/tenant-client'

const LIST_TTL = 15000

interface Filters {
  type?:     string
  inactive?: boolean
  module?: 'sales'
}

export function useCustomers(filters: Filters = {}) {
  const { userId, tenantId } = useTenant()
  const tenantFetch = useTenantFetch()
  const url = useMemo(() => {
    const params = new URLSearchParams()
    if (filters.module) params.set('module', filters.module)
    if (filters.type)     params.set('type',     filters.type)
    if (filters.inactive) params.set('inactive', 'true')
    const qs = params.toString()
    return `/api/customers${qs ? `?${qs}` : ''}`
  }, [filters.type, filters.inactive, filters.module])

  const { data, loading, error, refetch } = useCachedFetch<CustomerBalance[]>(
    url,
    { ttl: LIST_TTL },
  )

  async function createCustomer(payload: {
    contact_name:  string
    business_name?: string
    phone?:         string
    address?:       string
    customer_type?: string
    notes?:         string
  }) {
    const mutationScope = createCacheScope(userId, tenantId)
    const res = await tenantFetch('/api/customers', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error ?? 'Failed to create customer')
    if (mutationScope) cache.invalidatePattern(mutationScope, '/api/customers')
    await refetch()
    return result
  }

  async function updateCustomer(
    id: string,
    payload: Partial<{
      contact_name:  string
      business_name: string
      phone:         string
      address:       string
      customer_type: string
      notes:         string
      is_active:     boolean
    }>,
  ) {
    const mutationScope = createCacheScope(userId, tenantId)
    const res = await tenantFetch(`/api/customers/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error ?? 'Failed to update customer')
    if (mutationScope) cache.invalidatePattern(mutationScope, '/api/customers')
    await refetch()
    return result
  }

  return {
    customers: data ?? [],
    loading,
    error,
    refetch,
    createCustomer,
    updateCustomer,
  }
}
