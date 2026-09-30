'use client'

import { useCallback } from 'react'
import { useTenant, type TenantContext } from '@/lib/tenant-client'

type TenantFetchScope = Pick<TenantContext, 'isSuperAdmin' | 'tenantId' | 'selectedTenantId'>

const BUSINESS_API_ROOTS = new Set([
  'accounts', 'alerts', 'capital', 'cash-book', 'customers', 'dashboard',
  'egg-categories', 'expenses', 'partners', 'payments', 'profiles',
  'purchases', 'reports', 'sales', 'stock', 'supplier-payments', 'suppliers',
])

function isTenantBusinessPath(pathname: string): boolean {
  const segments = pathname.split('/')
  if (segments[1] !== 'api') return false

  let root: string
  try {
    root = decodeURIComponent(segments[2] ?? '')
  } catch {
    return false
  }

  if (root === 'settings') return segments.length === 3 ||
    (segments.length === 4 && segments[3] === '')
  return BUSINESS_API_ROOTS.has(root)
}

export function scopeTenantFetchInput(
  input: RequestInfo | URL,
  pageUrl: string,
  scope: TenantFetchScope,
): RequestInfo | URL {
  const original = typeof input === 'string'
    ? input
    : input instanceof URL ? input.href : input.url
  const target = new URL(original, pageUrl)

  if (target.origin !== new URL(pageUrl).origin ||
      !isTenantBusinessPath(target.pathname)) return input
  if (!scope.isSuperAdmin) return input

  throw new Error('Platform administrators cannot access business records')
}

export function useTenantFetch() {
  const scope = useTenant()

  return useCallback((input: RequestInfo | URL, init?: RequestInit) => {
    const scopedInput = scopeTenantFetchInput(input, window.location.href, scope)
    return window.fetch(scopedInput, init)
  }, [scope])
}
