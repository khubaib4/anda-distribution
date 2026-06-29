import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq } from '@/lib/tenant-api'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const { id } = await params
  const supabase = await createClient()

  let accountQuery = tenantEq(
    supabase
      .from('bank_accounts')
      .select('id, bank_name, account_holder, account_number, nickname, is_active')
      .eq('id', id),
    tenantId,
  )
  const { data: account, error: accountError } = await accountQuery.single()

  if (accountError) {
    return NextResponse.json({ error: accountError.message }, { status: 500 })
  }
  if (!account) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const [
    { data: customerPayments, error: customerPayError },
    { data: supplierPayments, error: supplierPayError },
    { data: expensesData,     error: expensesError     },
  ] = await Promise.all([
    tenantEq(
      supabase
        .from('customer_payments')
        .select('amount_paisa')
        .eq('bank_account_id', id),
      tenantId,
    ),
    tenantEq(
      supabase
        .from('supplier_payments')
        .select('amount_paisa')
        .eq('bank_account_id', id),
      tenantId,
    ),
    tenantEq(
      supabase
        .from('expenses')
        .select('amount_paisa')
        .eq('bank_account_id', id),
      tenantId,
    ),
  ])

  if (customerPayError) {
    return NextResponse.json({ error: customerPayError.message }, { status: 500 })
  }
  if (supplierPayError) {
    return NextResponse.json({ error: supplierPayError.message }, { status: 500 })
  }
  if (expensesError) {
    return NextResponse.json({ error: expensesError.message }, { status: 500 })
  }

  const total_received_paisa = (customerPayments ?? []).reduce(
    (sum, p) => sum + p.amount_paisa, 0,
  )
  const total_supplier_paid_paisa = (supplierPayments ?? []).reduce(
    (sum, p) => sum + p.amount_paisa, 0,
  )
  const total_expenses_paisa = (expensesData ?? []).reduce(
    (sum, e) => sum + e.amount_paisa, 0,
  )

  return NextResponse.json({
    bank_account_id:           account.id,
    bank_name:                 account.bank_name,
    account_holder:            account.account_holder,
    account_number:            account.account_number,
    nickname:                  account.nickname,
    is_active:                 account.is_active,
    total_received_paisa,
    total_supplier_paid_paisa,
    total_expenses_paisa,
    balance_paisa:
      total_received_paisa - total_supplier_paid_paisa - total_expenses_paisa,
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

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

  let updateQuery = supabase
    .from('bank_accounts')
    .update(updates)
    .eq('id', id)
  if (tenantId) updateQuery = updateQuery.eq('tenant_id', tenantId)

  const { data, error } = await updateQuery.select().single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
