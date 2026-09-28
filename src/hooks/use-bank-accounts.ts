'use client'

import type { BankAccountBalance } from '@/types'
import { cache, createCacheScope } from '@/lib/cache'
import { useCachedFetch } from '@/hooks/use-cached-fetch'
import { useTenantFetch } from '@/hooks/use-tenant-fetch'
import { useTenant } from '@/lib/tenant-client'

const LIST_TTL = 15000

export function useBankAccounts() {
  const { userId, tenantId } = useTenant()
  const tenantFetch = useTenantFetch()
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
    const mutationScope = createCacheScope(userId, tenantId)
    const res = await tenantFetch('/api/accounts', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error ?? 'Failed to create account')
    if (mutationScope) cache.invalidatePattern(mutationScope, '/api/accounts')
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
    const mutationScope = createCacheScope(userId, tenantId)
    const res = await tenantFetch(`/api/accounts/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error ?? 'Failed to update account')
    if (mutationScope) cache.invalidatePattern(mutationScope, '/api/accounts')
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
