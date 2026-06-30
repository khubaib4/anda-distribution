'use client'

import { useMemo } from 'react'
import type { CustomerBalance } from '@/types'
import { cache } from '@/lib/cache'
import { useCachedFetch } from '@/hooks/use-cached-fetch'

const LIST_TTL = 15000

interface Filters {
  type?:     string
  inactive?: boolean
}

export function useCustomers(filters: Filters = {}) {
  const url = useMemo(() => {
    const params = new URLSearchParams()
    if (filters.type)     params.set('type',     filters.type)
    if (filters.inactive) params.set('inactive', 'true')
    const qs = params.toString()
    return `/api/customers${qs ? `?${qs}` : ''}`
  }, [filters.type, filters.inactive])

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
    const res = await window.fetch('/api/customers', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error ?? 'Failed to create customer')
    cache.invalidatePattern('/api/customers')
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
    const res = await window.fetch(`/api/customers/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error ?? 'Failed to update customer')
    cache.invalidatePattern('/api/customers')
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
