import { NextResponse } from 'next/server'
import { requireTenant, type TenantContextResult } from '@/lib/tenant'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type OwnerSettingsAuth =
  | { ctx: TenantContextResult; tenantId: string }
  | NextResponse

async function requireOwnerSettings(request: Request): Promise<OwnerSettingsAuth> {
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

async function requireOwnerOnly(request: Request): Promise<OwnerSettingsAuth> {
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

async function enrichMembers(
  members: Array<{
    id: string
    user_id: string
    role: string
    permissions: Record<string, boolean> | null
    profile: { full_name: string } | { full_name: string }[] | null
  }>,
) {
  const admin = createAdminClient()

  return Promise.all(
    members.map(async m => {
      const profile = Array.isArray(m.profile) ? m.profile[0] : m.profile
      let email: string | null = null
      try {
        const { data } = await admin.auth.admin.getUserById(m.user_id)
        email = data.user?.email ?? null
      } catch {
        email = null
      }

      return {
        id:          m.id,
        user_id:     m.user_id,
        role:        m.role,
        permissions: m.permissions ?? {},
        full_name:   profile?.full_name ?? '—',
        email,
      }
    }),
  )
}

export async function GET(request: Request) {
  const auth = await requireOwnerSettings(request)
  if (auth instanceof NextResponse) return auth

  const { tenantId } = auth
  const supabase = await createClient()
  const now = new Date().toISOString()

  const [
    { data: tenant, error: tenantError },
    { data: members, error: membersError },
    { data: invitations, error: invitationsError },
  ] = await Promise.all([
    supabase
      .from('tenants')
      .select('id, name, slug, plan, is_active, created_at')
      .eq('id', tenantId)
      .single(),
    supabase
      .from('tenant_members')
      .select(`
        id,
        user_id,
        role,
        permissions,
        profile:profiles(full_name)
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true }),
    supabase
      .from('invitations')
      .select('id, email, role, token, expires_at, created_at, invited_by')
      .eq('tenant_id', tenantId)
      .is('accepted_at', null)
      .gt('expires_at', now)
      .order('created_at', { ascending: false }),
  ])

  if (tenantError) {
    return NextResponse.json({ error: tenantError.message }, { status: 500 })
  }
  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 })
  }
  if (invitationsError) {
    return NextResponse.json({ error: invitationsError.message }, { status: 500 })
  }

  const enrichedMembers = await enrichMembers(members ?? [])

  return NextResponse.json({
    tenant,
    members:     enrichedMembers,
    invitations: invitations ?? [],
  })
}

export async function PATCH(request: Request) {
  const auth = await requireOwnerSettings(request)
  if (auth instanceof NextResponse) return auth

  const { tenantId } = auth
  const body = await request.json()
  const { name } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Business name is required' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('tenants')
    .update({
      name:       name.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', tenantId)
    .select('id, name, slug, plan, is_active, created_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export { requireOwnerOnly, requireOwnerSettings }
