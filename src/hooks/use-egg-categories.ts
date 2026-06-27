'use client'

import { useState, useEffect } from 'react'
import type { EggCategory } from '@/types'

export function useEggCategories() {
  const [categories, setCategories] = useState<EggCategory[]>([])
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    window.fetch('/api/egg-categories')
      .then(r => r.json())
      .then(data => setCategories(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return { categories, loading }
}
