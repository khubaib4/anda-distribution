'use client'

import { useMemo } from 'react'
import type { CurrentStock, StockMovement } from '@/types'
import { useCachedFetch } from '@/hooks/use-cached-fetch'

const LIST_TTL = 15000

export function useCurrentStock() {
  const { data, loading, error, refetch } = useCachedFetch<CurrentStock[]>(
    '/api/stock',
    { ttl: LIST_TTL },
  )

  return {
    stock:   data ?? [],
    loading,
    error,
    refetch,
  }
}

export function useStockMovements(filters: {
  category_id?: string
  from?:        string
  to?:          string
  limit?:       number
} = {}) {
  const url = useMemo(() => {
    const params = new URLSearchParams()
    if (filters.category_id) params.set('category_id', filters.category_id)
    if (filters.from)        params.set('from',        filters.from)
    if (filters.to)          params.set('to',          filters.to)
    if (filters.limit)       params.set('limit',       String(filters.limit))
    const qs = params.toString()
    return `/api/stock/movements${qs ? `?${qs}` : ''}`
  }, [filters.category_id, filters.from, filters.to, filters.limit])

  const { data, loading, error, refetch } = useCachedFetch<StockMovement[]>(
    url,
    { ttl: LIST_TTL },
  )

  return {
    movements: data ?? [],
    loading,
    error,
    refetch,
  }
}
