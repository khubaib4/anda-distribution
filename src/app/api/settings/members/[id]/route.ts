import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireOwnerOnly } from '@/app/api/settings/route'

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
  const body = await request.json()
  const { role, permissions } = body

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (role        !== undefined) updates.role        = role
  if (permissions !== undefined) updates.permissions = permissions

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('tenant_members')
    .update(updates)
    .eq('id', memberId)
    .eq('tenant_id', tenantId)
    .select(`
      id,
      user_id,
      role,
      permissions,
      profile:profiles(full_name)
    `)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
