import { NextResponse } from 'next/server'
import { getTenantContext, type TenantContextResult } from '@/lib/tenant'

export function apiUnauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export type ApiAuthResult = {
  ctx:      TenantContextResult
  tenantId: string | null
}

export async function authorizeApi(
  request?: Request,
): Promise<ApiAuthResult | NextResponse> {
  const ctx = await getTenantContext()
  if (!ctx || (!ctx.tenantId && !ctx.isSuperAdmin)) {
    return apiUnauthorized()
  }

  let tenantId: string | null = ctx.tenantId
  if (ctx.isSuperAdmin && request) {
    const scoped = new URL(request.url).searchParams.get('tenant_id')
    if (scoped) tenantId = scoped
    else if (!ctx.tenantId) tenantId = null
  }

  return { ctx, tenantId }
}

export function tenantEq<T>(
  query: T,
  tenantId: string | null,
  column = 'tenant_id',
): T {
  if (!tenantId) return query
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
