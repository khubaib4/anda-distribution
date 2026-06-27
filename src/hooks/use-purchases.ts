'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Purchase } from '@/types'

interface Filters {
  status?:      string
  supplier_id?: string
  from?:        string
  to?:          string
}

export function usePurchases(filters: Filters = {}) {
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filters.status)      params.set('status',      filters.status)
      if (filters.supplier_id) params.set('supplier_id', filters.supplier_id)
      if (filters.from)        params.set('from',        filters.from)
      if (filters.to)          params.set('to',          filters.to)

      const qs  = params.toString()
      const res = await window.fetch(`/api/purchases${qs ? `?${qs}` : ''}`)
      if (!res.ok) throw new Error('Failed to load purchases')
      const data = await res.json()
      setPurchases(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [filters.status, filters.supplier_id, filters.from, filters.to])

  useEffect(() => { fetch() }, [fetch])

  return { purchases, loading, error, refetch: fetch }
}
