'use client'

import { useState, useEffect, useCallback } from 'react'
import type { CustomerBalance } from '@/types'

interface Filters {
  type?:     string
  inactive?: boolean
}

export function useCustomers(filters: Filters = {}) {
  const [customers, setCustomers] = useState<CustomerBalance[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filters.type)     params.set('type',     filters.type)
      if (filters.inactive) params.set('inactive', 'true')

      const qs  = params.toString()
      const res = await window.fetch(
        `/api/customers${qs ? `?${qs}` : ''}`
      )
      if (!res.ok) throw new Error('Failed to load customers')
      const data = await res.json()
      setCustomers(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [filters.type, filters.inactive])

  useEffect(() => { fetch() }, [fetch])

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
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Failed to create customer')
    await fetch()
    return data
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
    }>
  ) {
    const res = await window.fetch(`/api/customers/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Failed to update customer')
    await fetch()
    return data
  }

  return {
    customers,
    loading,
    error,
    refetch: fetch,
    createCustomer,
    updateCustomer,
  }
}
