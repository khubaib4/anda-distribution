'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Sale } from '@/types'

interface Filters {
  status?:      string
  customer_id?: string
  from?:        string
  to?:          string
}

export function useSales(filters: Filters = {}) {
  const [sales,   setSales]   = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filters.status)      params.set('status',      filters.status)
      if (filters.customer_id) params.set('customer_id', filters.customer_id)
      if (filters.from)        params.set('from',        filters.from)
      if (filters.to)          params.set('to',          filters.to)

      const qs  = params.toString()
      const res = await window.fetch(
        `/api/sales${qs ? `?${qs}` : ''}`
      )
      if (!res.ok) throw new Error('Failed to load sales')
      const data = await res.json()
      setSales(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [filters.status, filters.customer_id, filters.from, filters.to])

  useEffect(() => { fetch() }, [fetch])

  return { sales, loading, error, refetch: fetch }
}
