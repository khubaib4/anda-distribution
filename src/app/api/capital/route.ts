import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()

  // Get partner summaries from view
  const { data: summaries, error: summaryError } = await supabase
    .from('partner_capital_summary')
    .select('*')

  if (summaryError) {
    return NextResponse.json(
      { error: summaryError.message },
      { status: 500 }
    )
  }

  // Get all transactions with partner info
  const { data: transactions, error: txError } = await supabase
    .from('capital_transactions')
    .select(`
      *,
      partner:profiles!capital_transactions_partner_id_fkey(
        id, full_name
      )
    `)
    .order('transaction_date', { ascending: false })
    .order('created_at',       { ascending: false })

  if (txError) {
    return NextResponse.json({ error: txError.message }, { status: 500 })
  }

  const totalCapital = (summaries ?? []).reduce(
    (s: number, p: { net_capital_paisa: number }) =>
      s + p.net_capital_paisa, 0
  )

  return NextResponse.json({ summaries, transactions, totalCapital })
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const body = await request.json()

  const {
    partner_id,
    type,
    amount_paisa,
    transaction_date,
    reference,
    notes,
  } = body

  if (!partner_id) {
    return NextResponse.json(
      { error: 'Partner is required' },
      { status: 400 }
    )
  }
  if (!type || !['contribution', 'withdrawal'].includes(type)) {
    return NextResponse.json(
      { error: 'Type must be contribution or withdrawal' },
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
    .from('capital_transactions')
    .insert({
      partner_id,
      type,
      amount_paisa,
      transaction_date: transaction_date || new Date().toISOString().split('T')[0],
      reference:        reference        || null,
      notes:            notes            || null,
      created_by:       user?.id         || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
