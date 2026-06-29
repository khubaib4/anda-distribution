import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTenantContext } from '@/lib/tenant'
import { getDefaultPermissions } from '@/lib/permissions'

export async function GET() {
  const ctx = await getTenantContext()

  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (ctx.isSuperAdmin && !ctx.tenantId) {
    return NextResponse.json({
      userId:       ctx.userId,
      tenantId:     null,
      tenantName:   null,
      role:         'super_admin',
      isSuperAdmin: true,
      permissions:  getDefaultPermissions('super_admin'),
    })
  }

  if (!ctx.tenantId) {
    return NextResponse.json({ error: 'No tenant found' }, { status: 403 })
  }

  const supabase = await createClient()

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('name')
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
    userId:       ctx.userId,
    tenantId:     ctx.tenantId,
    tenantName:   tenant.name,
    role,
    isSuperAdmin: ctx.isSuperAdmin,
    permissions:  getDefaultPermissions(ctx.isSuperAdmin ? 'super_admin' : role),
  })
}
