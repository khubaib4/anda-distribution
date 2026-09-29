'use client'

import { useCallback, useLayoutEffect, useRef } from 'react'
import { useTenant } from '@/lib/tenant-client'

export function usePostMutationNavigationGuard() {
  const { isSuperAdmin, tenantId, selectedTenantId } = useTenant()
  const mounted = useRef(false)

  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  return useCallback(() => {
    if (!mounted.current || !tenantId) return false
    if (!isSuperAdmin) return true
    if (!selectedTenantId ||
        selectedTenantId.toLowerCase() !== tenantId.toLowerCase()) return false

    // The URL can veto stale navigation; the validated context still chooses the tenant.
    return new URLSearchParams(window.location.search)
      .get('tenant_id')?.toLowerCase() === selectedTenantId.toLowerCase()
  }, [isSuperAdmin, tenantId, selectedTenantId])
}
