'use client'

import { useMemo } from 'react'
import type { Sale } from '@/types'
import { useCachedFetch } from '@/hooks/use-cached-fetch'

const LIST_TTL = 15000

interface Filters {
  status?:      string
  customer_id?: string
  from?:        string
  to?:          string
}

export function useSales(filters: Filters = {}) {
  const url = useMemo(() => {
    const params = new URLSearchParams()
    if (filters.status)      params.set('status',      filters.status)
    if (filters.customer_id) params.set('customer_id', filters.customer_id)
    if (filters.from)        params.set('from',        filters.from)
    if (filters.to)          params.set('to',          filters.to)
    const qs = params.toString()
    return `/api/sales${qs ? `?${qs}` : ''}`
  }, [filters.status, filters.customer_id, filters.from, filters.to])

  const { data, loading, error, refetch } = useCachedFetch<Sale[]>(
    url,
    { ttl: LIST_TTL },
  )

  return {
    sales:   data ?? [],
    loading,
    error,
    refetch,
  }
}
