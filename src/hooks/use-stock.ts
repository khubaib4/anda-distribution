'use client'

import { useState, useEffect, useCallback } from 'react'
import type { CurrentStock, StockMovement } from '@/types'

export function useCurrentStock() {
  const [stock,   setStock]   = useState<CurrentStock[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.fetch('/api/stock')
      if (!res.ok) throw new Error('Failed to load stock')
      const data = await res.json()
      setStock(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { stock, loading, error, refetch: fetch }
}

export function useStockMovements(filters: {
  category_id?: string
  from?:        string
  to?:          string
  limit?:       number
} = {}) {
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filters.category_id) params.set('category_id', filters.category_id)
      if (filters.from)        params.set('from',        filters.from)
      if (filters.to)          params.set('to',          filters.to)
      if (filters.limit)       params.set('limit',       String(filters.limit))

      const qs  = params.toString()
      const res = await window.fetch(
        `/api/stock/movements${qs ? `?${qs}` : ''}`
      )
      if (!res.ok) throw new Error('Failed to load movements')
      const data = await res.json()
      setMovements(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [filters.category_id, filters.from, filters.to, filters.limit])

  useEffect(() => { fetch() }, [fetch])

  return { movements, loading, error, refetch: fetch }
}
