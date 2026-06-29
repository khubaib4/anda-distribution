import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'

export async function GET(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const supabase = await createClient()

  let transactionsQuery = supabase
    .from('capital_transactions')
    .select(`
      *,
      partner:profiles!capital_transactions_partner_id_fkey(
        id, full_name
      )
    `)
    .order('transaction_date', { ascending: false })
    .order('created_at',       { ascending: false })
  transactionsQuery = tenantEq(transactionsQuery, tenantId)

  const { data: transactions, error: txError } = await transactionsQuery

  if (txError) {
    return NextResponse.json({ error: txError.message }, { status: 500 })
  }

  const summaryMap = new Map<string, {
    partner_id:               string
    full_name:                string
    total_contributed_paisa:  number
    total_withdrawn_paisa:    number
    net_capital_paisa:        number
  }>()

  for (const tx of transactions ?? []) {
    const partnerId   = tx.partner_id
    const fullName    = tx.partner?.full_name ?? 'Unknown'
    const existing    = summaryMap.get(partnerId) ?? {
      partner_id:              partnerId,
      full_name:               fullName,
      total_contributed_paisa: 0,
      total_withdrawn_paisa:   0,
      net_capital_paisa:       0,
    }

    if (tx.type === 'contribution') {
      existing.total_contributed_paisa += tx.amount_paisa
    } else if (tx.type === 'withdrawal') {
      existing.total_withdrawn_paisa += tx.amount_paisa
    }

    existing.net_capital_paisa =
      existing.total_contributed_paisa - existing.total_withdrawn_paisa
    summaryMap.set(partnerId, existing)
  }

  const summaries = [...summaryMap.values()].sort((a, b) =>
    a.full_name.localeCompare(b.full_name),
  )

  const totalCapital = summaries.reduce(
    (s, p) => s + p.net_capital_paisa,
    0,
  )

  return NextResponse.json({ summaries, transactions, totalCapital })
}

export async function POST(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const writeTenantId = requireWriteTenantId(tenantId, request)
  if (writeTenantId instanceof NextResponse) return writeTenantId

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
      tenant_id:        writeTenantId,
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
