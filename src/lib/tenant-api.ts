import { NextResponse } from 'next/server'
import { getTenantContext, type TenantContextResult } from '@/lib/tenant'
import { hasModulePermission, type ModulePermission } from '@/lib/permissions'

export function apiUnauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export type ApiAuthResult = {
  ctx:      TenantContextResult
  tenantId: string
}

export async function authorizeApi(
  request: Request,
  options: { permission?: ModulePermission } = {},
): Promise<ApiAuthResult | NextResponse> {
  const ctx = await getTenantContext()
  if (!ctx) {
    return apiUnauthorized()
  }

  // Platform administrators never acquire business access through a tenant
  // selector or a coincidental membership. Deny before any business query.
  if (ctx.isSuperAdmin || ctx.role === 'super_admin') {
    return NextResponse.json({ error: 'Tenant business access is forbidden' }, { status: 403 })
  }
  void request
  if (!ctx.tenantId) return apiUnauthorized()
  if (options.permission && !hasModulePermission(ctx.permissions, options.permission)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return { ctx, tenantId: ctx.tenantId }
}

export function tenantEq<T>(
  query: T,
  tenantId: string,
  column = 'tenant_id',
): T {
  if (!tenantId?.trim()) throw new Error('Tenant scope is required')
  return (query as { eq: (column: string, value: string) => T }).eq(column, tenantId)
}

export function resolveWriteTenantId(
  tenantId: string | null,
  request?: Request,
): string | null {
  if (tenantId) return tenantId
  if (request) {
    return new URL(request.url).searchParams.get('tenant_id')
  }
  return null
}

export function requireWriteTenantId(
  tenantId: string | null,
  request?: Request,
): string | NextResponse {
  const writeTenantId = resolveWriteTenantId(tenantId, request)
  if (!writeTenantId) {
    return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 })
  }
  return writeTenantId
}
