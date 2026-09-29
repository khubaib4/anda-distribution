'use client'

import { useState, useEffect } from 'react'
import type { EggCategory } from '@/types'
import { useTenantFetch } from '@/hooks/use-tenant-fetch'

export function useEggCategories() {
  const tenantFetch = useTenantFetch()
  const [categories, setCategories] = useState<EggCategory[]>([])
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    tenantFetch('/api/egg-categories')
      .then(r => {
        if (!r.ok) throw new Error('Failed to load egg categories')
        return r.json()
      })
      .then(data => setCategories(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [tenantFetch])

  return { categories, loading }
}
