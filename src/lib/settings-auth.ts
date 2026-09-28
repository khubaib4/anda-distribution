import { NextResponse } from 'next/server'
import { requireTenant, type TenantContextResult } from '@/lib/tenant'

type OwnerSettingsAuth =
  | { ctx: TenantContextResult; tenantId: string }
  | NextResponse

export async function requireOwnerSettings(request: Request): Promise<OwnerSettingsAuth> {
  let ctx: TenantContextResult
  try {
    ctx = await requireTenant()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!ctx.isSuperAdmin && ctx.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let tenantId = ctx.tenantId
  if (ctx.isSuperAdmin) {
    const scoped = new URL(request.url).searchParams.get('tenant_id')
    if (scoped) tenantId = scoped
  }

  if (!tenantId) {
    return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 })
  }

  return { ctx, tenantId }
}

export async function requireOwnerOnly(request: Request): Promise<OwnerSettingsAuth> {
  void request
  let ctx: TenantContextResult
  try {
    ctx = await requireTenant()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (ctx.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!ctx.tenantId) {
    return NextResponse.json({ error: 'No tenant found' }, { status: 400 })
  }

  return { ctx, tenantId: ctx.tenantId }
}
