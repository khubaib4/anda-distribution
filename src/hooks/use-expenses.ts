'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Expense, ExpenseCategory } from '@/types'
import { cache } from '@/lib/cache'
import { useCachedFetch } from '@/hooks/use-cached-fetch'

const LIST_TTL = 15000

interface Filters {
  category_id?: string
  from?:        string
  to?:          string
}

export function useExpenses(filters: Filters = {}) {
  const url = useMemo(() => {
    const params = new URLSearchParams()
    if (filters.category_id) params.set('category_id', filters.category_id)
    if (filters.from)        params.set('from',        filters.from)
    if (filters.to)          params.set('to',          filters.to)
    const qs = params.toString()
    return `/api/expenses${qs ? `?${qs}` : ''}`
  }, [filters.category_id, filters.from, filters.to])

  const { data, loading, error, refetch } = useCachedFetch<Expense[]>(
    url,
    { ttl: LIST_TTL },
  )

  type ExpensePayload = {
    category_id:     string
    amount_paisa:    number
    expense_date:    string
    description:     string
    vehicle?:        string
    odometer_km?:    number
    worker_name?:    string
    labor_type?:     string
    notes?:          string
    bank_account_id?: string
    paid_by?:        'business' | 'partner'
    paid_by_partner_id?: string
    paid_by_partner_source?: 'profile' | 'partner'
  }

  async function createExpense(payload: ExpensePayload) {
    const res = await window.fetch('/api/expenses', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error ?? 'Failed to create expense')
    cache.invalidatePattern('/api/expenses')
    await refetch()
    return result as Expense
  }

  async function updateExpense(id: string, payload: ExpensePayload) {
    const res = await window.fetch(`/api/expenses/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error ?? 'Failed to update expense')
    cache.invalidatePattern('/api/expenses')
    await refetch()
    return result as Expense
  }

  async function deleteExpense(id: string) {
    const res = await window.fetch(`/api/expenses/${id}`, {
      method: 'DELETE',
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error ?? 'Failed to delete expense')
    cache.invalidatePattern('/api/expenses')
    await refetch()
  }

  return {
    expenses: data ?? [],
    loading,
    error,
    refetch,
    createExpense,
    updateExpense,
    deleteExpense,
  }
}

export function useExpenseCategories() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    window.fetch('/api/expenses/categories')
      .then(r => r.json())
      .then(data => setCategories(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return { categories, loading }
}
