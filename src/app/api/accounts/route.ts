import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('bank_account_balances')
    .select('*')
    .order('bank_name')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const body = await request.json()

  const {
    bank_name,
    account_holder,
    account_number,
    nickname,
  } = body

  if (!bank_name?.trim()) {
    return NextResponse.json(
      { error: 'Bank name is required' },
      { status: 400 }
    )
  }
  if (!account_holder?.trim()) {
    return NextResponse.json(
      { error: 'Account holder is required' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('bank_accounts')
    .insert({
      bank_name:      bank_name.trim(),
      account_holder: account_holder.trim(),
      account_number: account_number?.trim() || null,
      nickname:       nickname?.trim()       || null,
      created_by:     user?.id               || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
