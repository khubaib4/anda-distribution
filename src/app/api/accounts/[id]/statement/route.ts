import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const [
    { data: customerPayments, error: customerPayError },
    { data: supplierPayments, error: supplierPayError },
    { data: expensesData,     error: expensesError     },
  ] = await Promise.all([
    supabase
      .from('customer_payments')
      .select(`
        id,
        amount_paisa,
        payment_date,
        payment_method,
        created_at,
        customer:customers(contact_name)
      `)
      .eq('bank_account_id', id)
      .order('payment_date', { ascending: true })
      .order('created_at',   { ascending: true }),

    supabase
      .from('supplier_payments')
      .select(`
        id,
        amount_paisa,
        payment_date,
        payment_method,
        created_at,
        supplier:suppliers(name)
      `)
      .eq('bank_account_id', id)
      .order('payment_date', { ascending: true })
      .order('created_at',   { ascending: true }),

    supabase
      .from('expenses')
      .select(`
        id,
        amount_paisa,
        expense_date,
        description,
        created_at,
        category:expense_categories(name, icon)
      `)
      .eq('bank_account_id', id)
      .order('expense_date', { ascending: true })
      .order('created_at',   { ascending: true }),
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

  type StatementEntry = {
    id:              string
    entry_type:      'customer_payment' | 'supplier_payment' | 'expense'
    entry_date:      string
    created_at:      string
    description:     string
    credit_paisa:    number
    debit_paisa:     number
    running_balance: number
    payment_method?: string
  }

  const entries: Omit<StatementEntry, 'running_balance'>[] = []

  for (const payment of customerPayments ?? []) {
    const customer = Array.isArray(payment.customer)
      ? payment.customer[0]
      : payment.customer
    entries.push({
      id:             payment.id,
      entry_type:     'customer_payment',
      entry_date:     payment.payment_date,
      created_at:     payment.created_at,
      description:    `Payment — ${customer?.contact_name ?? 'Customer'}`,
      credit_paisa:   payment.amount_paisa,
      debit_paisa:    0,
      payment_method: payment.payment_method ?? undefined,
    })
  }

  for (const payment of supplierPayments ?? []) {
    const supplier = Array.isArray(payment.supplier)
      ? payment.supplier[0]
      : payment.supplier
    entries.push({
      id:             payment.id,
      entry_type:     'supplier_payment',
      entry_date:     payment.payment_date,
      created_at:     payment.created_at,
      description:    `Supplier payment — ${supplier?.name ?? 'Supplier'}`,
      credit_paisa:   0,
      debit_paisa:    payment.amount_paisa,
      payment_method: payment.payment_method ?? undefined,
    })
  }

  for (const expense of expensesData ?? []) {
    const category = Array.isArray(expense.category)
      ? expense.category[0]
      : expense.category
    const icon = category?.icon ?? '📋'
    entries.push({
      id:           expense.id,
      entry_type:   'expense',
      entry_date:   expense.expense_date,
      created_at:   expense.created_at,
      description:  `${icon} ${expense.description}`,
      credit_paisa: 0,
      debit_paisa:  expense.amount_paisa,
    })
  }

  entries.sort((a, b) => {
    if (a.entry_date !== b.entry_date) {
      return a.entry_date.localeCompare(b.entry_date)
    }
    return a.created_at.localeCompare(b.created_at)
  })

  let balance = 0
  const withBalance: StatementEntry[] = entries.map(entry => {
    balance += entry.credit_paisa - entry.debit_paisa
    return { ...entry, running_balance: balance }
  })

  const total_credit_paisa = withBalance.reduce((s, e) => s + e.credit_paisa, 0)
  const total_debit_paisa  = withBalance.reduce((s, e) => s + e.debit_paisa,  0)

  return NextResponse.json({
    entries: withBalance,
    summary: {
      total_credit_paisa,
      total_debit_paisa,
      closing_balance: balance,
    },
  })
}
