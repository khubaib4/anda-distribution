import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface InvitationRow {
  id:          string
  email:       string
  role:        string
  tenant_id:   string
  invited_by:  string
  accepted_at: string | null
  expires_at:  string
}

type InvitationValidation =
  | { ok: true; invitation: InvitationRow }
  | { ok: false; status: number; error: string }

async function validateInvitation(token: string): Promise<InvitationValidation> {
  const admin = createAdminClient()

  const { data: invitation, error } = await admin
    .from('invitations')
    .select('id, email, role, tenant_id, invited_by, accepted_at, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (error) {
    return { ok: false, status: 500, error: error.message }
  }
  if (!invitation) {
    return { ok: false, status: 404, error: 'Invitation not found' }
  }
  if (invitation.accepted_at) {
    return { ok: false, status: 400, error: 'Invitation already used' }
  }
  if (new Date(invitation.expires_at) < new Date()) {
    return { ok: false, status: 400, error: 'Invitation expired' }
  }

  return { ok: true, invitation }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const result = await validateInvitation(token)

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const admin = createAdminClient()
  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .select('name')
    .eq('id', result.invitation.tenant_id)
    .single()

  if (tenantError) {
    return NextResponse.json({ error: tenantError.message }, { status: 500 })
  }

  return NextResponse.json({
    email:       result.invitation.email,
    role:        result.invitation.role,
    tenant_name: tenant.name,
    tenant_id:   result.invitation.tenant_id,
    expires_at:  result.invitation.expires_at,
  })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: paramToken } = await params
  const body = await request.json()
  const { token: bodyToken, password, full_name } = body
  const token = paramToken || bodyToken

  if (!password || !full_name?.trim()) {
    return NextResponse.json(
      { error: 'Full name and password are required' },
      { status: 400 },
    )
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 },
    )
  }

  const result = await validateInvitation(token)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const { invitation } = result
  const admin = createAdminClient()

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email:         invitation.email,
    password,
    email_confirm: true,
  })

  if (authError) {
    const message = authError.message.toLowerCase().includes('already')
      ? 'An account with this email already exists'
      : authError.message
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const userId = authData.user.id

  const { error: profileError } = await admin.from('profiles').insert({
    id:        userId,
    full_name: full_name.trim(),
    role:      'staff',
    tenant_id: invitation.tenant_id,
  })

  if (profileError) {
    await admin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  const { error: memberError } = await admin.from('tenant_members').insert({
    tenant_id:  invitation.tenant_id,
    user_id:    userId,
    role:       invitation.role,
    invited_by: invitation.invited_by,
  })

  if (memberError) {
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: memberError.message }, { status: 500 })
  }

  const { error: acceptError } = await admin
    .from('invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('token', token)

  if (acceptError) {
    await admin.from('tenant_members').delete().eq('user_id', userId)
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: acceptError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, email: invitation.email })
}
