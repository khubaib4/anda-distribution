'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTenant } from '@/lib/tenant-client'
import { scopeTenantNavigationHref } from '@/lib/tenant-navigation'

export function useTenantRouter() {
  const router = useRouter()
  const scope = useTenant()

  return useMemo(() => ({
    push: (href: string, options?: Parameters<typeof router.push>[1]) =>
      router.push(scopeTenantNavigationHref(href, scope), options),
    replace: (href: string, options?: Parameters<typeof router.replace>[1]) =>
      router.replace(scopeTenantNavigationHref(href, scope), options),
    refresh: () => router.refresh(),
  }), [router, scope])
}
