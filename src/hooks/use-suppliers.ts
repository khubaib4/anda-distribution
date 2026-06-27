'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Supplier } from '@/types'

export function useSuppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.fetch('/api/suppliers')
      if (!res.ok) throw new Error('Failed to load suppliers')
      const data = await res.json()
      setSuppliers(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  async function createSupplier(payload: {
    name: string
    phone?: string
    address?: string
    notes?: string
  }) {
    const res = await window.fetch('/api/suppliers', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Failed to create supplier')
    await fetch()
    return data as Supplier
  }

  async function updateSupplier(
    id: string,
    payload: Partial<{
      name:      string
      phone:     string
      address:   string
      notes:     string
      is_active: boolean
    }>
  ) {
    const res = await window.fetch(`/api/suppliers/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Failed to update supplier')
    await fetch()
    return data as Supplier
  }

  return { suppliers, loading, error, refetch: fetch, createSupplier, updateSupplier }
}
