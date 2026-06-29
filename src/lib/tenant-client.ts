'use client'

import { createContext, useContext } from 'react'
import type { Permissions } from '@/lib/permissions'

export type { Permissions }

export interface TenantContext {
  userId:       string
  tenantId:     string | null
  tenantName:   string | null
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

export type TenantContextResponse = Omit<TenantContext, 'permissions'>

export async function fetchTenantContext(): Promise<{
  data:  TenantContextResponse | null
  status: number
}> {
  try {
    const res = await window.fetch('/api/me')
    if (!res.ok) {
      return { data: null, status: res.status }
    }
    const data = await res.json()
    return { data, status: res.status }
  } catch {
    return { data: null, status: 0 }
  }
}
