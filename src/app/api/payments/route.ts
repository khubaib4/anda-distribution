import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const customerId = searchParams.get('customer_id')

  let query = supabase
    .from('customer_payments')
    .select('*')
    .order('payment_date', { ascending: false })

  if (customerId) query = query.eq('customer_id', customerId)

  const { data, error } = await query

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
    customer_id,
    amount_paisa,
    payment_date,
    payment_method,
    reference,
    notes,
    bank_account_id,
  } = body

  if (!customer_id) {
    return NextResponse.json(
      { error: 'Customer is required' },
      { status: 400 }
    )
  }
  if (!amount_paisa || amount_paisa <= 0) {
    return NextResponse.json(
      { error: 'Amount must be greater than 0' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('customer_payments')
    .insert({
      customer_id,
      amount_paisa,
      payment_date:   payment_date   || new Date().toISOString().split('T')[0],
      payment_method: payment_method || null,
      reference:      reference      || null,
      notes:          notes          || null,
      bank_account_id: bank_account_id || null,
      created_by:     user?.id       || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
