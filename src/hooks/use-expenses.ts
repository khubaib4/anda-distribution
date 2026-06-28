'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Expense, ExpenseCategory } from '@/types'

interface Filters {
  category_id?: string
  from?:        string
  to?:          string
}

export function useExpenses(filters: Filters = {}) {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filters.category_id) params.set('category_id', filters.category_id)
      if (filters.from)        params.set('from',        filters.from)
      if (filters.to)          params.set('to',          filters.to)

      const qs  = params.toString()
      const res = await window.fetch(
        `/api/expenses${qs ? `?${qs}` : ''}`
      )
      if (!res.ok) throw new Error('Failed to load expenses')
      const data = await res.json()
      setExpenses(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [filters.category_id, filters.from, filters.to])

  useEffect(() => { fetch() }, [fetch])

  async function createExpense(payload: {
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
  }) {
    const res = await window.fetch('/api/expenses', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Failed to create expense')
    await fetch()
    return data as Expense
  }

  return { expenses, loading, error, refetch: fetch, createExpense }
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
