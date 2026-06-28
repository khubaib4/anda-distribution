import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('bank_account_balances')
    .select('*')
    .eq('bank_account_id', id)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const body = await request.json()

  const {
    bank_name,
    account_holder,
    account_number,
    nickname,
    is_active,
  } = body

  if (bank_name !== undefined && !bank_name?.trim()) {
    return NextResponse.json(
      { error: 'Bank name is required' },
      { status: 400 }
    )
  }
  if (account_holder !== undefined && !account_holder?.trim()) {
    return NextResponse.json(
      { error: 'Account holder is required' },
      { status: 400 }
    )
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (bank_name      !== undefined) updates.bank_name      = bank_name.trim()
  if (account_holder !== undefined) updates.account_holder = account_holder.trim()
  if (account_number !== undefined) updates.account_number = account_number?.trim() || null
  if (nickname       !== undefined) updates.nickname       = nickname?.trim()       || null
  if (is_active      !== undefined) updates.is_active      = is_active

  const { data, error } = await supabase
    .from('bank_accounts')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
