import { NextResponse } from 'next/server'
import { getTenantContext, type TenantContextResult } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'

const TENANT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function apiUnauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export type ApiAuthResult = {
  ctx:      TenantContextResult
  tenantId: string
}

export async function authorizeApi(
  request?: Request,
): Promise<ApiAuthResult | NextResponse> {
  const ctx = await getTenantContext()
  if (!ctx) {
    return apiUnauthorized()
  }

  if (!ctx.isSuperAdmin) {
    if (!ctx.tenantId) return apiUnauthorized()
    return { ctx, tenantId: ctx.tenantId }
  }

  const searchParams = request ? new URL(request.url).searchParams : null
  const tenantId = searchParams?.has('tenant_id')
    ? searchParams.get('tenant_id')
    : ctx.tenantId

  if (!tenantId) {
    return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 })
  }
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    return NextResponse.json({ error: 'Invalid tenant_id' }, { status: 400 })
  }

  const { data: tenant, error } = await createAdminClient()
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Unable to validate tenant_id' }, { status: 500 })
  }
  if (!tenant) {
    return NextResponse.json({ error: 'Invalid tenant_id' }, { status: 400 })
  }

  return { ctx, tenantId }
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
