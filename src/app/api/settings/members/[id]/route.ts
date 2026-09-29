import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireOwnerOnly } from '@/lib/settings-auth'
import { storedModuleOverrides, validateModuleOverrides } from '@/lib/permissions'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireOwnerOnly(request)
  if (auth instanceof NextResponse) return auth

  const { ctx, tenantId } = auth
  const { id: memberId } = await params
  const supabase = await createClient()

  const { data: member, error: fetchError } = await supabase
    .from('tenant_members')
    .select('id, user_id')
    .eq('id', memberId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }
  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  if (member.user_id === ctx.userId) {
    return NextResponse.json(
      { error: 'You cannot remove yourself from the team' },
      { status: 400 },
    )
  }

  const { error } = await supabase
    .from('tenant_members')
    .delete()
    .eq('id', memberId)
    .eq('tenant_id', tenantId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireOwnerOnly(request)
  if (auth instanceof NextResponse) return auth

  const { tenantId } = auth
  const { id: memberId } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { role, permissions } = body as Record<string, unknown>

  if (role !== undefined && role !== 'owner' && role !== 'staff') {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const overrides = permissions === undefined
    ? undefined
    : validateModuleOverrides(permissions)
  if (overrides === null) {
    return NextResponse.json({ error: 'Invalid permissions' }, { status: 400 })
  }
  if (role === undefined && (!overrides || Object.keys(overrides).length === 0)) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: existing, error: fetchError } = await supabase
    .from('tenant_members')
    .select('id, user_id, role, permissions')
    .eq('id', memberId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }
  if (!existing) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }
  if (overrides && (existing.role !== 'staff' || role === 'owner')) {
    return NextResponse.json(
      { error: 'Only staff permissions can be edited' },
      { status: 400 },
    )
  }

  const updates: Record<string, unknown> = {}
  if (role        !== undefined) updates.role        = role
  if (overrides) {
    updates.permissions = {
      ...storedModuleOverrides(existing.permissions),
      ...overrides,
    }
  }

  let updateQuery = supabase
    .from('tenant_members')
    .update(updates)
    .eq('id', memberId)
    .eq('tenant_id', tenantId)
  if (overrides) updateQuery = updateQuery.eq('role', 'staff')

  const { data: member, error } = await updateQuery
    .select('id, user_id, role, permissions')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  let profile: { full_name: string | null } | null = null
  try {
    const { data, error: profileError } = await createAdminClient()
      .from('profiles')
      .select('full_name')
      .eq('id', member.user_id)
      .maybeSingle()

    if (profileError) throw profileError
    profile = data
  } catch (enrichmentError) {
    console.error('Tenant member updated but profile enrichment failed', {
      tenantId,
      memberId,
      userId: member.user_id,
      error: enrichmentError,
    })
  }

  return NextResponse.json({ ...member, profile })
}
