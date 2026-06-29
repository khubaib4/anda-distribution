import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'

async function enrichTenant(tenant: {
  id: string
  name: string
  slug: string
  plan: string
  is_active: boolean
  created_at: string
  owner_id: string | null
}) {
  const admin = createAdminClient()

  const [{ count: memberCount }, { data: profile }] = await Promise.all([
    admin
      .from('tenant_members')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id),
    tenant.owner_id
      ? admin.from('profiles').select('id, full_name').eq('id', tenant.owner_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  let ownerEmail: string | null = null
  if (tenant.owner_id) {
    try {
      const { data } = await admin.auth.admin.getUserById(tenant.owner_id)
      ownerEmail = data.user?.email ?? null
    } catch {
      ownerEmail = null
    }
  }

  return {
    id:           tenant.id,
    name:         tenant.name,
    slug:         tenant.slug,
    plan:         tenant.plan,
    is_active:    tenant.is_active,
    created_at:   tenant.created_at,
    member_count: memberCount ?? 0,
    owner: profile
      ? { full_name: profile.full_name, email: ownerEmail }
      : null,
  }
}

async function enrichMembers(
  members: Array<{
    id: string
    user_id: string
    role: string
    created_at: string
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
        id:         m.id,
        user_id:    m.user_id,
        role:       m.role,
        full_name:  profile?.full_name ?? '—',
        email,
        joined_at:  m.created_at,
      }
    }),
  )
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data: tenant, error } = await admin
    .from('tenants')
    .select('id, name, slug, plan, is_active, created_at, owner_id')
    .eq('id', id)
    .single()

  if (error || !tenant) {
    return NextResponse.json(
      { error: error?.message ?? 'Not found' },
      { status: error ? 500 : 404 },
    )
  }

  const [
    enrichedTenant,
    { data: members, error: membersError },
    { data: invitations, error: invitationsError },
  ] = await Promise.all([
    enrichTenant(tenant),
    admin
      .from('tenant_members')
      .select(`
        id,
        user_id,
        role,
        created_at,
        profile:profiles(full_name)
      `)
      .eq('tenant_id', id)
      .order('created_at', { ascending: true }),
    admin
      .from('invitations')
      .select('id, email, role, expires_at, created_at')
      .eq('tenant_id', id)
      .is('accepted_at', null)
      .gt('expires_at', now)
      .order('created_at', { ascending: false }),
  ])

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 500 })
  }
  if (invitationsError) {
    return NextResponse.json({ error: invitationsError.message }, { status: 500 })
  }

  const enrichedMembers = await enrichMembers(members ?? [])

  return NextResponse.json({
    tenant:      enrichedTenant,
    members:     enrichedMembers,
    invitations: invitations ?? [],
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await request.json()
  const { name, plan, is_active } = body

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (name      !== undefined) updates.name      = name.trim()
  if (plan      !== undefined) updates.plan      = plan
  if (is_active !== undefined) updates.is_active = is_active

  const admin = createAdminClient()

  const { data: tenant, error } = await admin
    .from('tenants')
    .update(updates)
    .eq('id', id)
    .select('id, name, slug, plan, is_active, created_at, owner_id')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(await enrichTenant(tenant))
}
