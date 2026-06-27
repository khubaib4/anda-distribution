import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  // Fetch sales for this customer
  const { data: salesData, error: salesError } = await supabase
    .from('sales')
    .select(`
      id,
      sale_date,
      invoice_number,
      payment_status,
      items:sale_items(
        quantity_trays,
        price_per_tray_paisa
      )
    `)
    .eq('customer_id', id)
    .order('sale_date', { ascending: true })
    .order('created_at', { ascending: true })

  if (salesError) {
    return NextResponse.json({ error: salesError.message }, { status: 500 })
  }

  // Fetch payments for this customer
  const { data: paymentsData, error: paymentsError } = await supabase
    .from('customer_payments')
    .select('*')
    .eq('customer_id', id)
    .order('payment_date', { ascending: true })
    .order('created_at', { ascending: true })

  if (paymentsError) {
    return NextResponse.json(
      { error: paymentsError.message },
      { status: 500 }
    )
  }

  // Build ledger entries
  type LedgerEntry = {
    id:             string
    entry_type:     'sale' | 'payment'
    entry_date:     string
    description:    string
    debit_paisa:    number   // amount customer owes (sale)
    credit_paisa:   number   // amount customer paid (payment)
    running_balance: number  // cumulative balance (positive = customer owes us)
    invoice_number?: string
    payment_method?: string
  }

  const entries: Omit<LedgerEntry, 'running_balance'>[] = []

  // Add sales as debits
  for (const sale of salesData ?? []) {
    const total = (sale.items ?? []).reduce(
      (sum: number, item: {
        quantity_trays: number
        price_per_tray_paisa: number
      }) => sum + item.quantity_trays * item.price_per_tray_paisa,
      0
    )
    entries.push({
      id:             sale.id,
      entry_type:     'sale',
      entry_date:     sale.sale_date,
      description:    `Sale — ${sale.invoice_number}`,
      debit_paisa:    total,
      credit_paisa:   0,
      invoice_number: sale.invoice_number ?? undefined,
    })
  }

  // Add payments as credits
  for (const payment of paymentsData ?? []) {
    entries.push({
      id:             payment.id,
      entry_type:     'payment',
      entry_date:     payment.payment_date,
      description:    payment.notes
        ? `Payment — ${payment.notes}`
        : 'Payment received',
      debit_paisa:    0,
      credit_paisa:   payment.amount_paisa,
      payment_method: payment.payment_method ?? undefined,
    })
  }

  // Sort by date then type (payments before sales on same day)
  entries.sort((a, b) => {
    if (a.entry_date !== b.entry_date) {
      return a.entry_date.localeCompare(b.entry_date)
    }
    // On same date: payments first
    if (a.entry_type === 'payment' && b.entry_type === 'sale') return -1
    if (a.entry_type === 'sale' && b.entry_type === 'payment') return 1
    return 0
  })

  // Compute running balance
  let balance = 0
  const ledger: LedgerEntry[] = entries.map(entry => {
    balance += entry.debit_paisa - entry.credit_paisa
    return { ...entry, running_balance: balance }
  })

  return NextResponse.json({
    ledger,
    summary: {
      total_debit_paisa:  ledger.reduce((s, e) => s + e.debit_paisa,  0),
      total_credit_paisa: ledger.reduce((s, e) => s + e.credit_paisa, 0),
      closing_balance:    balance,
    },
  })
}
