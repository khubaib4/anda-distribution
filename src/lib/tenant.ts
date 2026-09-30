import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePermissions, type Permissions } from '@/lib/permissions'

export type TenantRole = 'owner' | 'staff' | 'super_admin'

export interface TenantContextResult {
  userId:       string
  tenantId:     string | null
  role:         TenantRole | null
  isSuperAdmin: boolean
  permissions:  Permissions
}

export async function getTenantContext(): Promise<TenantContextResult | null> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return null

    const adminClient = createAdminClient()
    const [membership, superAdmin] = await Promise.all([
      adminClient
        .from('tenant_members')
        .select('tenant_id, role, permissions')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle(),
      adminClient
        .from('super_admins')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle(),
    ])

    if (membership.error || superAdmin.error) return null
    if (superAdmin.data) {
      return {
        userId:       user.id,
        tenantId:     null,
        role:         'super_admin',
        isSuperAdmin: true,
        permissions:  resolvePermissions('super_admin', null),
      }
    }

    const memberRow = membership.data
    if (!memberRow || (memberRow.role !== 'owner' && memberRow.role !== 'staff')) {
      return null
    }

    return {
      userId:       user.id,
      tenantId:     memberRow.tenant_id,
      role:         memberRow.role,
      isSuperAdmin: false,
      permissions:  resolvePermissions(memberRow.role, memberRow.permissions),
    }
  } catch {
    return null
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
