import { NextResponse } from 'next/server'
import { getTenantContext, type TenantContextResult } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'

const TENANT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type SuperAdminTenantValidation =
  | { ok: true; tenant: { id: string; name: string; logo_url: string | null } }
  | { ok: false; reason: 'missing' | 'invalid' | 'not_found' | 'database_error' }

export async function validateSuperAdminTenantId(
  tenantId: string | null,
): Promise<SuperAdminTenantValidation> {
  if (!tenantId) return { ok: false, reason: 'missing' }
  if (!TENANT_ID_PATTERN.test(tenantId)) return { ok: false, reason: 'invalid' }

  try {
    const { data: tenant, error } = await createAdminClient()
      .from('tenants')
      .select('id, name, logo_url')
      .eq('id', tenantId)
      .maybeSingle()

    if (error) return { ok: false, reason: 'database_error' }
    if (!tenant) return { ok: false, reason: 'not_found' }
    return { ok: true, tenant }
  } catch {
    return { ok: false, reason: 'database_error' }
  }
}

export function apiUnauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function requireSuperAdminTenantSelection(
  request: Request,
): Promise<string | NextResponse> {
  const searchParams = new URL(request.url).searchParams
  if (!searchParams.has('tenant_id')) {
    return NextResponse.json(
      { error: 'tenant_id is required', code: 'TENANT_SELECTION_REQUIRED' },
      { status: 400 },
    )
  }

  const selection = await validateSuperAdminTenantId(searchParams.get('tenant_id'))
  if (!selection.ok) {
    if (selection.reason === 'database_error') {
      return NextResponse.json(
        { error: 'Unable to validate tenant_id', code: 'TENANT_VALIDATION_FAILED' },
        { status: 500 },
      )
    }
    if (selection.reason === 'not_found') {
      return NextResponse.json(
        { error: 'Tenant not found', code: 'TENANT_NOT_FOUND' },
        { status: 404 },
      )
    }
    return NextResponse.json(
      { error: 'Invalid tenant_id', code: 'TENANT_SELECTION_INVALID' },
      { status: 400 },
    )
  }

  return selection.tenant.id
}

export type ApiAuthResult = {
  ctx:      TenantContextResult
  tenantId: string
}

export async function authorizeApi(
  request: Request,
): Promise<ApiAuthResult | NextResponse> {
  const ctx = await getTenantContext()
  if (!ctx) {
    return apiUnauthorized()
  }

  if (!ctx.isSuperAdmin) {
    if (!ctx.tenantId) return apiUnauthorized()
    return { ctx, tenantId: ctx.tenantId }
  }

  const tenantId = await requireSuperAdminTenantSelection(request)
  if (tenantId instanceof NextResponse) return tenantId

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
