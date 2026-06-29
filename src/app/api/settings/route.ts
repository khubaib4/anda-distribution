import { NextResponse } from 'next/server'
import { requireTenant, type TenantContextResult } from '@/lib/tenant'
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

async function fetchMembers(tenantId: string) {
  const admin = createAdminClient()

  const { data: members, error: membersError } = await admin
    .from('tenant_members')
    .select('id, user_id, role, joined_at')
    .eq('tenant_id', tenantId)
    .order('joined_at', { ascending: true })

  if (membersError) {
    return { error: membersError.message as string, members: [] as never[] }
  }

  const rows = members ?? []
  if (rows.length === 0) {
    return { members: [] }
  }

  const userIds = rows.map(m => m.user_id)
  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select('id, full_name')
    .in('id', userIds)

  if (profilesError) {
    return { error: profilesError.message, members: [] as never[] }
  }

  const nameByUserId = new Map((profiles ?? []).map(p => [p.id, p.full_name]))

  return {
    members: rows.map(m => ({
      id:        m.id,
      user_id:   m.user_id,
      role:      m.role,
      full_name: nameByUserId.get(m.user_id) ?? '—',
      joined_at: m.joined_at,
    })),
  }
}

export async function GET(request: Request) {
  const auth = await requireOwnerSettings(request)
  if (auth instanceof NextResponse) return auth

  const { tenantId } = auth
  const admin = createAdminClient()
  const now = new Date().toISOString()

  const [
    { data: tenant, error: tenantError },
    membersResult,
    { data: invitations, error: invitationsError },
  ] = await Promise.all([
    admin
      .from('tenants')
      .select('id, name, slug, plan, is_active, created_at')
      .eq('id', tenantId)
      .maybeSingle(),
    fetchMembers(tenantId),
    admin
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
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }
  if ('error' in membersResult && membersResult.error) {
    return NextResponse.json({ error: membersResult.error }, { status: 500 })
  }
  if (invitationsError) {
    return NextResponse.json({ error: invitationsError.message }, { status: 500 })
  }

  return NextResponse.json({
    tenant,
    members:     membersResult.members,
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

  const admin = createAdminClient()

  const { data, error } = await admin
    .from('tenants')
    .update({
      name:       name.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', tenantId)
    .select('id, name, slug, plan, is_active, created_at')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  return NextResponse.json(data)
}

export { requireOwnerOnly, requireOwnerSettings }
