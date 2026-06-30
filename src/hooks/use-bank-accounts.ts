'use client'

import type { BankAccountBalance } from '@/types'
import { cache } from '@/lib/cache'
import { useCachedFetch } from '@/hooks/use-cached-fetch'

const LIST_TTL = 15000

export function useBankAccounts() {
  const { data, loading, error, refetch } = useCachedFetch<BankAccountBalance[]>(
    '/api/accounts',
    { ttl: LIST_TTL },
  )

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
    const result = await res.json()
    if (!res.ok) throw new Error(result.error ?? 'Failed to create account')
    cache.invalidatePattern('/api/accounts')
    await refetch()
    return result
  }

  async function updateAccount(
    id: string,
    payload: Partial<{
      bank_name:      string
      account_holder: string
      account_number: string
      nickname:       string
      is_active:      boolean
    }>,
  ) {
    const res = await window.fetch(`/api/accounts/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error ?? 'Failed to update account')
    cache.invalidatePattern('/api/accounts')
    await refetch()
    return result
  }

  return {
    accounts: data ?? [],
    loading,
    error,
    refetch,
    createAccount,
    updateAccount,
  }
}
