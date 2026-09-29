import type { TenantContext } from '@/lib/tenant-client'

type TenantNavigationScope = Pick<
  TenantContext,
  'isSuperAdmin' | 'tenantId' | 'selectedTenantId'
>

const NAVIGATION_ORIGIN = 'https://tenant-navigation.invalid'

const BUSINESS_PAGE_ROOTS = new Set([
  'accounts', 'alerts', 'capital', 'cash-book', 'customers', 'expenses',
  'purchases', 'reports', 'sales', 'settings', 'stock', 'suppliers',
])

function isTenantBusinessPage(pathname: string): boolean {
  if (pathname === '/') return true

  const root = pathname.split('/')[1]
  try {
    return BUSINESS_PAGE_ROOTS.has(decodeURIComponent(root))
  } catch {
    return false
  }
}

export function scopeTenantNavigationHref(
  href: string,
  scope: TenantNavigationScope,
): string {
  if (!scope.isSuperAdmin || !href.startsWith('/') || href.startsWith('//')) {
    return href
  }

  const url = new URL(href, NAVIGATION_ORIGIN)
  if (url.origin !== NAVIGATION_ORIGIN || !isTenantBusinessPage(url.pathname)) {
    return href
  }

  if (scope.selectedTenantId &&
      scope.tenantId?.toLowerCase() === scope.selectedTenantId.toLowerCase()) {
    url.searchParams.set('tenant_id', scope.selectedTenantId)
  } else {
    // Without a validated selection, let TenantProvider show its chooser.
    url.searchParams.delete('tenant_id')
  }

  return `${url.pathname}${url.search}${url.hash}`
}
