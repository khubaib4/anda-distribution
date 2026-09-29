import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTenantContext } from '@/lib/tenant'
import { validateSuperAdminTenantId } from '@/lib/tenant-api'

export async function GET(request: Request) {
  const ctx = await getTenantContext()

  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (ctx.isSuperAdmin) {
    const searchParams = new URL(request.url).searchParams
    if (searchParams.has('tenant_id')) {
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

      const tenant = selection.tenant
      return NextResponse.json({
        userId:           ctx.userId,
        tenantId:         tenant.id,
        selectedTenantId: tenant.id,
        tenantName:       tenant.name,
        logoUrl:          tenant.logo_url ?? null,
        role:             'super_admin',
        isSuperAdmin:     true,
        permissions:      ctx.permissions,
      })
    }

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
