import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import '@/env'

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
  const setupSecret = process.env.ADMIN_SETUP_SECRET
  if (!setupSecret) {
    return NextResponse.json(
      { error: 'Setup is not configured' },
      { status: 503 },
    )
  }

  const body = await request.json()
  const { secret_key, user_email } = body

  if (secret_key !== setupSecret) {
    return NextResponse.json({ error: 'Invalid secret key' }, { status: 403 })
  }

  if (!user_email?.trim()) {
    return NextResponse.json({ error: 'user_email is required' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { count, error: countError } = await admin
    .from('super_admins')
    .select('*', { count: 'exact', head: true })

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 })
  }

  if (count && count > 0) {
    return NextResponse.json(
      { error: 'Setup already completed' },
      { status: 403 },
    )
  }

  const userId = await findUserIdByEmail(user_email)
  if (!userId) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const { error: insertError } = await admin
    .from('super_admins')
    .insert({ user_id: userId })

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
