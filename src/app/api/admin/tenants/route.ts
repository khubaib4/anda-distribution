import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function uniqueSlug(base: string): Promise<string> {
  const admin = createAdminClient()
  let slug = slugify(base) || 'tenant'
  let attempt = slug
  let i = 0

  while (true) {
    const { data } = await admin
      .from('tenants')
      .select('id')
      .eq('slug', attempt)
      .maybeSingle()

    if (!data) return attempt
    i += 1
    attempt = `${slug}-${i}`
  }
}

const EGG_CATEGORIES = ['Double', 'Large', 'Medium', 'Small']

const EXPENSE_CATEGORIES = [
  { name: 'Fuel',               icon: '⛽' },
  { name: 'Labor',              icon: '👷' },
  { name: 'Rent',               icon: '🏠' },
  { name: 'Loading/Unloading',  icon: '📦' },
  { name: 'Packaging',          icon: '📦' },
  { name: 'Other',              icon: '📋' },
]

async function enrichTenants(tenants: Array<{
  id: string
  name: string
  slug: string
  plan: string
  is_active: boolean
  created_at: string
  owner_id: string | null
}>) {
  const admin = createAdminClient()
  const tenantIds = tenants.map(t => t.id)
  const ownerIds = tenants.map(t => t.owner_id).filter(Boolean) as string[]

  const [{ data: members }, { data: profiles }] = await Promise.all([
    tenantIds.length > 0
      ? admin.from('tenant_members').select('tenant_id, user_id, role').in('tenant_id', tenantIds)
      : Promise.resolve({ data: [] as Array<{ tenant_id: string; user_id: string; role: string }> }),
    ownerIds.length > 0
      ? admin.from('profiles').select('id, full_name').in('id', ownerIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
  ])

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p.full_name]))
  const memberCounts = new Map<string, number>()

  for (const m of members ?? []) {
    memberCounts.set(m.tenant_id, (memberCounts.get(m.tenant_id) ?? 0) + 1)
  }

  return tenants.map(t => ({
    id:           t.id,
    name:         t.name,
    slug:         t.slug,
    plan:         t.plan,
    is_active:    t.is_active,
    created_at:   t.created_at,
    member_count: memberCounts.get(t.id) ?? 0,
    owner: t.owner_id
      ? { full_name: profileMap.get(t.owner_id) ?? '—' }
      : null,
  }))
}

export async function GET() {
  try {
    await requireSuperAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()

  const { data: tenants, error } = await admin
    .from('tenants')
    .select('id, name, slug, plan, is_active, created_at, owner_id')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const enriched = await enrichTenants(tenants ?? [])
  return NextResponse.json(enriched)
}

export async function POST(request: Request) {
  try {
    await requireSuperAdmin()
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()

  const {
    tenant_name,
    owner_email,
    owner_password,
    owner_full_name,
    plan = 'trial',
  } = body

  if (!tenant_name?.trim()) {
    return NextResponse.json({ error: 'Business name is required' }, { status: 400 })
  }
  if (!owner_email?.trim()) {
    return NextResponse.json({ error: 'Owner email is required' }, { status: 400 })
  }
  if (!owner_password || owner_password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 },
    )
  }
  if (!owner_full_name?.trim()) {
    return NextResponse.json({ error: 'Owner full name is required' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email:         owner_email.trim(),
    password:      owner_password,
    email_confirm: true,
    user_metadata: { full_name: owner_full_name.trim() },
  })

  if (authError) {
    const message = authError.message.includes('already')
      ? 'An account with this email already exists'
      : authError.message
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const userId = authData.user.id
  const slug   = await uniqueSlug(tenant_name)

  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .insert({
      name:     tenant_name.trim(),
      slug,
      owner_id: userId,
      plan,
      is_active: true,
    })
    .select('id, name, slug, plan, is_active, created_at, owner_id')
    .single()

  if (tenantError) {
    await admin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: tenantError.message }, { status: 500 })
  }

  const { error: memberError } = await admin.from('tenant_members').insert({
    tenant_id: tenant.id,
    user_id:   userId,
    role:      'owner',
  })

  if (memberError) {
    await admin.from('tenants').delete().eq('id', tenant.id)
    await admin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: memberError.message }, { status: 500 })
  }

  const { error: profileError } = await admin.from('profiles').insert({
    id:        userId,
    full_name: owner_full_name.trim(),
    role:      'partner',
    tenant_id: tenant.id,
  })

  if (profileError) {
    await admin.from('tenant_members').delete().eq('tenant_id', tenant.id)
    await admin.from('tenants').delete().eq('id', tenant.id)
    await admin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  const eggRows = EGG_CATEGORIES.map((name, i) => ({
    name,
    tenant_id:     tenant.id,
    display_order: i + 1,
    is_active:     true,
  }))

  const { error: eggError } = await admin.from('egg_categories').insert(eggRows)
  if (eggError) {
    return NextResponse.json({ error: eggError.message }, { status: 500 })
  }

  const expenseRows = EXPENSE_CATEGORIES.map(c => ({
    name:      c.name,
    icon:      c.icon,
    tenant_id: tenant.id,
  }))

  const { error: expenseError } = await admin.from('expense_categories').insert(expenseRows)
  if (expenseError) {
    return NextResponse.json({ error: expenseError.message }, { status: 500 })
  }

  const [enriched] = await enrichTenants([tenant])
  return NextResponse.json(enriched, { status: 201 })
}
