import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireOwnerOnly } from '@/app/api/settings/route'

async function findUserIdByEmail(email: string): Promise<string | null> {
  const admin = createAdminClient()
  const target = email.trim().toLowerCase()
  let page = 1

  while (page <= 10) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data.users.length) return null

    const user = data.users.find(u => u.email?.toLowerCase() === target)
    if (user) return user.id

    if (data.users.length < 200) return null
    page += 1
  }

  return null
}

export async function POST(request: Request) {
  const auth = await requireOwnerOnly(request)
  if (auth instanceof NextResponse) return auth

  const { ctx, tenantId } = auth
  const body = await request.json()
  const { email, role = 'staff' } = body

  if (!email?.trim()) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  const normalizedEmail = email.trim().toLowerCase()
  const supabase = await createClient()

  const existingUserId = await findUserIdByEmail(normalizedEmail)
  if (existingUserId) {
    const { data: existingMember } = await supabase
      .from('tenant_members')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', existingUserId)
      .maybeSingle()

    if (existingMember) {
      return NextResponse.json(
        { error: 'This user is already a member of your team' },
        { status: 400 },
      )
    }
  }

  const { data: pendingInvite } = await supabase
    .from('invitations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('email', normalizedEmail)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (pendingInvite) {
    return NextResponse.json(
      { error: 'A pending invitation already exists for this email' },
      { status: 400 },
    )
  }

  const token = crypto.randomUUID()
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7)

  const { data: invitation, error } = await supabase
    .from('invitations')
    .insert({
      tenant_id:  tenantId,
      email:      normalizedEmail,
      role,
      token,
      invited_by: ctx.userId,
      expires_at: expiresAt.toISOString(),
    })
    .select('id, email, role, token, expires_at, created_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(invitation, { status: 201 })
}
