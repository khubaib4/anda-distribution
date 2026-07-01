import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'
import { enrichExpensesWithPartnerNames } from '@/lib/expense-partners'

export async function GET(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)

  const categoryId = searchParams.get('category_id')
  const from       = searchParams.get('from')
  const to         = searchParams.get('to')

  let query = tenantEq(
    supabase
      .from('expenses')
      .select(`
        *,
        category:expense_categories(id, name, icon)
      `),
    tenantId,
  )
    .order('expense_date', { ascending: false })
    .order('created_at',   { ascending: false })

  if (categoryId) query = query.eq('category_id', categoryId)
  if (from)       query = query.gte('expense_date', from)
  if (to)         query = query.lte('expense_date', to)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const enriched = await enrichExpensesWithPartnerNames(supabase, data ?? [])
  return NextResponse.json(enriched)
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
    category_id,
    amount_paisa,
    expense_date,
    description,
    vehicle,
    odometer_km,
    worker_name,
    labor_type,
    notes,
    bank_account_id,
    paid_by,
    paid_by_partner_id,
    paid_by_partner_source,
  } = body

  if (!category_id) {
    return NextResponse.json(
      { error: 'Category is required' },
      { status: 400 }
    )
  }
  if (!amount_paisa || amount_paisa <= 0) {
    return NextResponse.json(
      { error: 'Amount must be greater than 0' },
      { status: 400 }
    )
  }
  if (!description?.trim()) {
    return NextResponse.json(
      { error: 'Description is required' },
      { status: 400 }
    )
  }
  if (!expense_date) {
    return NextResponse.json(
      { error: 'Date is required' },
      { status: 400 }
    )
  }

  const paidBy = paid_by === 'partner' ? 'partner' : 'business'

  if (paidBy === 'partner' && !paid_by_partner_id) {
    return NextResponse.json(
      { error: 'Partner is required when paid by partner' },
      { status: 400 },
    )
  }

  const trimmedDescription = description.trim()

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      tenant_id:              writeTenantId,
      category_id,
      amount_paisa,
      expense_date,
      description:            trimmedDescription,
      vehicle:                vehicle                || null,
      odometer_km:            odometer_km            || null,
      worker_name:            worker_name            || null,
      labor_type:             labor_type             || null,
      notes:                  notes                  || null,
      bank_account_id:        bank_account_id        || null,
      paid_by:                paidBy,
      paid_by_partner_id:     paidBy === 'partner' ? paid_by_partner_id : null,
      paid_by_partner_source: paidBy === 'partner' ? paid_by_partner_source : null,
      created_by:             user?.id               || null,
    })
    .select(`*, category:expense_categories(id, name, icon)`)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (paidBy === 'partner' && paid_by_partner_id) {
    const capitalInsert: Record<string, unknown> = {
      tenant_id:        writeTenantId,
      type:             'contribution',
      amount_paisa,
      transaction_date: expense_date,
      notes:            `Paid expense: ${trimmedDescription}`,
      reference:        null,
      created_by:       user?.id || null,
    }

    if (paid_by_partner_source === 'partner') {
      capitalInsert.partner_id         = null
      capitalInsert.partner_profile_id = paid_by_partner_id
    } else {
      capitalInsert.partner_id         = paid_by_partner_id
      capitalInsert.partner_profile_id = null
    }

    const { error: capitalError } = await supabase
      .from('capital_transactions')
      .insert(capitalInsert)

    if (capitalError) {
      return NextResponse.json(
        { error: `Expense saved but capital entry failed: ${capitalError.message}` },
        { status: 500 },
      )
    }
  }

  const [enriched] = await enrichExpensesWithPartnerNames(supabase, [data])
  return NextResponse.json(enriched, { status: 201 })
}
