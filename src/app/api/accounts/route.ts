import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'

function aggregateBankBalances(
  accounts: Array<{
    id: string
    bank_name: string
    account_holder: string
    account_number: string | null
    nickname: string | null
    is_active: boolean
  }>,
  customerPayments: Array<{ bank_account_id: string; amount_paisa: number }>,
  supplierPayments: Array<{ bank_account_id: string; amount_paisa: number }>,
  expenses: Array<{ bank_account_id: string; amount_paisa: number }>,
) {
  const receivedByAccount  = new Map<string, number>()
  const supplierByAccount  = new Map<string, number>()
  const expensesByAccount  = new Map<string, number>()

  for (const p of customerPayments) {
    receivedByAccount.set(
      p.bank_account_id,
      (receivedByAccount.get(p.bank_account_id) ?? 0) + p.amount_paisa,
    )
  }
  for (const p of supplierPayments) {
    supplierByAccount.set(
      p.bank_account_id,
      (supplierByAccount.get(p.bank_account_id) ?? 0) + p.amount_paisa,
    )
  }
  for (const e of expenses) {
    expensesByAccount.set(
      e.bank_account_id,
      (expensesByAccount.get(e.bank_account_id) ?? 0) + e.amount_paisa,
    )
  }

  return accounts.map(account => {
    const total_received_paisa      = receivedByAccount.get(account.id) ?? 0
    const total_supplier_paid_paisa = supplierByAccount.get(account.id) ?? 0
    const total_expenses_paisa      = expensesByAccount.get(account.id) ?? 0

    return {
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
    }
  })
}

export async function GET(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const supabase = await createClient()

  let accountsQuery = tenantEq(
    supabase
      .from('bank_accounts')
      .select('id, bank_name, account_holder, account_number, nickname, is_active'),
    tenantId,
  ).order('bank_name')

  const { data: accounts, error: accountsError } = await accountsQuery

  if (accountsError) {
    return NextResponse.json({ error: accountsError.message }, { status: 500 })
  }

  let customerPaymentsQuery = tenantEq(
    supabase
      .from('customer_payments')
      .select('bank_account_id, amount_paisa')
      .not('bank_account_id', 'is', null),
    tenantId,
  )
  let supplierPaymentsQuery = tenantEq(
    supabase
      .from('supplier_payments')
      .select('bank_account_id, amount_paisa')
      .not('bank_account_id', 'is', null),
    tenantId,
  )
  let expensesQuery = tenantEq(
    supabase
      .from('expenses')
      .select('bank_account_id, amount_paisa')
      .not('bank_account_id', 'is', null),
    tenantId,
  )

  const [
    { data: customerPayments, error: customerPayError },
    { data: supplierPayments, error: supplierPayError },
    { data: expensesData,     error: expensesError     },
  ] = await Promise.all([
    customerPaymentsQuery,
    supplierPaymentsQuery,
    expensesQuery,
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

  const data = aggregateBankBalances(
    accounts ?? [],
    (customerPayments ?? []) as Array<{ bank_account_id: string; amount_paisa: number }>,
    (supplierPayments ?? []) as Array<{ bank_account_id: string; amount_paisa: number }>,
    (expensesData ?? []) as Array<{ bank_account_id: string; amount_paisa: number }>,
  )

  return NextResponse.json(data)
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
      tenant_id:      writeTenantId,
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
