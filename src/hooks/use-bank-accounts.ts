'use client'

import { useState, useEffect, useCallback } from 'react'
import type { BankAccountBalance } from '@/types'

export function useBankAccounts() {
  const [accounts, setAccounts] = useState<BankAccountBalance[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.fetch('/api/accounts')
      if (!res.ok) throw new Error('Failed to load accounts')
      const data = await res.json()
      setAccounts(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  async function createAccount(payload: {
    bank_name:      string
    account_holder: string
    account_number?: string
    nickname?:      string
  }) {
    const res = await window.fetch('/api/accounts', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Failed to create account')
    await fetch()
    return data
  }

  async function updateAccount(
    id: string,
    payload: Partial<{
      bank_name:      string
      account_holder: string
      account_number: string
      nickname:       string
      is_active:      boolean
    }>
  ) {
    const res = await window.fetch(`/api/accounts/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Failed to update account')
    await fetch()
    return data
  }

  return {
    accounts,
    loading,
    error,
    refetch: fetch,
    createAccount,
    updateAccount,
  }
}
