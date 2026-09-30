import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface InvitationRow {
  id:          string
  email:       string
  role:        string
  tenant_id:   string
  invited_by:  string
  accepted_at: string | null
  expires_at:  string | null
}

type InvitationValidation =
  | { ok: true; invitation: InvitationRow }
  | { ok: false; status: number; error: string }

async function validateInvitation(
  token: string,
  checkExpiry = true,
): Promise<InvitationValidation> {
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
  if (invitation.role !== 'staff') {
    return { ok: false, status: 400, error: 'Invalid invitation role' }
  }
  if (checkExpiry && invitation.expires_at && new Date(invitation.expires_at) <= new Date()) {
    return { ok: false, status: 400, error: 'Invitation expired' }
  }

  return { ok: true, invitation }
}

interface AcceptanceSnapshot {
  invitations: Array<InvitationRow & { token_matches: boolean }>
  memberships: Array<{ tenant_id: string; user_id: string; role: string; invited_by: string }>
  profiles: Array<{ id: string; tenant_id: string; role: string; full_name: string }>
  auth_user: { id: string; email: string } | null
}

type AcceptanceOutcome =
  | { state: 'committed' }
  | { state: 'ambiguous'; reason: string }

function normalizedEmail(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null
}

async function reconcileAcceptance(
  admin: ReturnType<typeof createAdminClient>,
  invitation: InvitationRow,
  token: string,
  createdUserId: string,
  fullName: string,
): Promise<AcceptanceOutcome> {
  try {
    // This read can confirm a commit and waits for a currently held invite lock.
    // A pending snapshot cannot fence a consume that acquires the lock later.
    const { data, error } = await admin.rpc('read_staff_invitation_acceptance_de_security_01', {
      p_invitation_id: String(invitation.id), p_token: token,
      p_tenant_id: invitation.tenant_id, p_user_id: createdUserId,
    })
    if (error) return { state: 'ambiguous', reason: 'trusted_read_failed' }
    const snapshot = data as AcceptanceSnapshot | null
    if (!snapshot || !Array.isArray(snapshot.invitations)
        || !Array.isArray(snapshot.memberships) || !Array.isArray(snapshot.profiles)
        || snapshot.invitations.length !== 1) {
      return { state: 'ambiguous', reason: 'missing_or_unexpected_invitation_state' }
    }
    const current = snapshot.invitations[0]
    const intendedEmail = normalizedEmail(invitation.email)
    if (!current || String(current.id) !== String(invitation.id)
        || current.token_matches !== true || current.tenant_id !== invitation.tenant_id
        || current.role !== 'staff' || current.invited_by !== invitation.invited_by
        || !intendedEmail || normalizedEmail(current.email) !== intendedEmail
        || snapshot.auth_user?.id !== createdUserId
        || normalizedEmail(snapshot.auth_user.email) !== intendedEmail) {
      return { state: 'ambiguous', reason: 'acceptance_identity_mismatch' }
    }
    if (typeof current.accepted_at === 'string' && current.accepted_at) {
      const member = snapshot.memberships[0]
      const profile = snapshot.profiles[0]
      if (snapshot.memberships.length === 1 && snapshot.profiles.length === 1
          && member?.tenant_id === invitation.tenant_id && member.user_id === createdUserId
          && member.role === 'staff' && member.invited_by === invitation.invited_by
          && profile?.id === createdUserId && profile.tenant_id === invitation.tenant_id
          && profile.role === 'staff' && profile.full_name === fullName) {
        return { state: 'committed' }
      }
      return { state: 'ambiguous', reason: 'accepted_invitation_without_expected_access_state' }
    }
    if (current.accepted_at === null
        && snapshot.memberships.length === 0 && snapshot.profiles.length === 0) {
      return { state: 'ambiguous', reason: 'pending_without_access_state' }
    }
    return { state: 'ambiguous', reason: 'inconsistent_acceptance_state' }
  } catch {
    return { state: 'ambiguous', reason: 'trusted_read_threw_or_invalid_snapshot' }
  }
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
  const fullName = full_name.trim()

  // The RPC checks expiry against the database clock at consumption time.
  const result = await validateInvitation(token, false)
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

  // No automatic Auth deletion is safe once the consume RPC is invoked,
  // even if a later snapshot still shows pending/no membership.
  const createdUserId = authData.user.id

  let consumed = false
  let rpcFailed = false
  try {
    const result = await admin.rpc('consume_staff_invitation_de_security_01', {
      p_invitation_id: String(invitation.id),
      p_token: token,
      p_tenant_id: invitation.tenant_id,
      p_user_id: createdUserId,
      p_full_name: fullName,
    })
    consumed = result.data === true
    rpcFailed = Boolean(result.error)
  } catch {
    rpcFailed = true
  }

  if (rpcFailed || !consumed) {
    const outcome = await reconcileAcceptance(
      admin, invitation, token, createdUserId, fullName,
    )
    if (outcome.state === 'committed') {
      return NextResponse.json({ success: true, email: invitation.email })
    }
    console.error('Invitation acceptance requires reconciliation; Auth user preserved', {
      invitationId: invitation.id, tenantId: invitation.tenant_id,
      createdUserId, reason: outcome.reason,
    })
    return NextResponse.json(
      { error: 'Invitation acceptance could not be confirmed; administrator reconciliation is required' },
      { status: 503 },
    )
  }

  return NextResponse.json({ success: true, email: invitation.email })
}
