import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTenantContext } from '@/lib/tenant'

export async function GET() {
  const ctx = await getTenantContext()

  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (ctx.isSuperAdmin) {
    return NextResponse.json({
      userId:           ctx.userId,
      tenantId:         null,
      selectedTenantId: null,
      tenantName:       null,
      logoUrl:          null,
      role:             'super_admin',
      isSuperAdmin:     true,
      permissions:      ctx.permissions,
    })
  }

  if (!ctx.tenantId) {
    return NextResponse.json({ error: 'No tenant found' }, { status: 403 })
  }

  const supabase = await createClient()

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('name, logo_url')
    .eq('id', ctx.tenantId)
    .single()

  if (error || !tenant) {
    return NextResponse.json(
      { error: error?.message ?? 'Tenant not found' },
      { status: 404 },
    )
  }

  const role = ctx.role ?? 'staff'

  return NextResponse.json({
    userId:           ctx.userId,
    tenantId:         ctx.tenantId,
    selectedTenantId: null,
    tenantName:       tenant.name,
    logoUrl:          tenant.logo_url ?? null,
    role,
    isSuperAdmin:     ctx.isSuperAdmin,
    permissions:      ctx.permissions,
  })
}
