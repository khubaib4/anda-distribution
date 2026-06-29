import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export type TenantRole = 'owner' | 'staff' | 'super_admin'

export interface TenantContextResult {
  userId:       string
  tenantId:     string | null
  role:         TenantRole | null
  isSuperAdmin: boolean
}

export async function getTenantContext(): Promise<TenantContextResult | null> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const adminClient = createAdminClient()

  const [{ data: memberRow }, { data: superAdminRow }] = await Promise.all([
    adminClient
      .from('tenant_members')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle(),
    adminClient
      .from('super_admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  const isSuperAdmin = !!superAdminRow

  if (isSuperAdmin) {
    return {
      userId:       user.id,
      tenantId:     memberRow?.tenant_id ?? null,
      role:         'super_admin',
      isSuperAdmin: true,
    }
  }

  return {
    userId:       user.id,
    tenantId:     memberRow?.tenant_id ?? null,
    role:         (memberRow?.role as TenantRole | undefined) ?? null,
    isSuperAdmin: false,
  }
}

export async function requireTenant(): Promise<TenantContextResult> {
  const ctx = await getTenantContext()

  if (!ctx) {
    throw new Error('Unauthorized')
  }

  if (!ctx.tenantId && !ctx.isSuperAdmin) {
    throw new Error('No tenant found')
  }

  return ctx
}

export async function requireSuperAdmin(): Promise<TenantContextResult> {
  const ctx = await getTenantContext()

  if (!ctx?.isSuperAdmin) {
    throw new Error('Forbidden')
  }

  return ctx
}
