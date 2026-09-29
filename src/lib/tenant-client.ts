'use client'

import { createContext, useContext } from 'react'
import type { Permissions } from '@/lib/permissions'

export type { Permissions }

export interface TenantContext {
  userId:       string
  tenantId:     string | null
  selectedTenantId: string | null
  tenantName:   string | null
  logoUrl:      string | null
  role:         'owner' | 'staff' | 'super_admin'
  isSuperAdmin: boolean
  permissions:  Permissions
}

export const TenantContext = createContext<TenantContext | null>(null)

export function useTenant(): TenantContext {
  const ctx = useContext(TenantContext)
  if (!ctx) {
    throw new Error('useTenant must be used within TenantProvider')
  }
  return ctx
}

export type TenantContextResponse = TenantContext

export type TenantSelectionErrorCode =
  | 'TENANT_SELECTION_INVALID'
  | 'TENANT_NOT_FOUND'
  | 'TENANT_VALIDATION_FAILED'

export async function fetchTenantContext(
  selectedTenantId: string | null,
  signal?: AbortSignal,
): Promise<{
  data:      TenantContextResponse | null
  status:    number
  errorCode: TenantSelectionErrorCode | null
}> {
  try {
    const url = selectedTenantId === null
      ? '/api/me'
      : `/api/me?${new URLSearchParams({ tenant_id: selectedTenantId })}`
    const res = await window.fetch(url, { signal })
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { code?: string } | null
      const code = body?.code
      const errorCode = code === 'TENANT_SELECTION_INVALID' ||
        code === 'TENANT_NOT_FOUND' || code === 'TENANT_VALIDATION_FAILED'
        ? code
        : null
      return { data: null, status: res.status, errorCode }
    }
    const data = await res.json() as TenantContextResponse
    return { data, status: res.status, errorCode: null }
  } catch {
    return { data: null, status: 0, errorCode: null }
  }
}
