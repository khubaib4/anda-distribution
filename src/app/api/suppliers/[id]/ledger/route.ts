import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  // Fetch purchases for this supplier
  const { data: purchasesData, error: purchasesError } = await supabase
    .from('purchases')
    .select(`
      id,
      purchase_date,
      invoice_number,
      payment_status,
      items:purchase_items(
        quantity_trays,
        price_per_tray_paisa
      )
    `)
    .eq('supplier_id', id)
    .order('purchase_date', { ascending: true })
    .order('created_at',    { ascending: true })

  if (purchasesError) {
    return NextResponse.json(
      { error: purchasesError.message },
      { status: 500 }
    )
  }

  // Fetch payments to this supplier
  const { data: paymentsData, error: paymentsError } = await supabase
    .from('supplier_payments')
    .select('*')
    .eq('supplier_id', id)
    .order('payment_date', { ascending: true })
    .order('created_at',   { ascending: true })

  if (paymentsError) {
    return NextResponse.json(
      { error: paymentsError.message },
      { status: 500 }
    )
  }

  // Build ledger entries
  type LedgerEntry = {
    id:              string
    entry_type:      'purchase' | 'payment'
    entry_date:      string
    description:     string
    debit_paisa:     number
    credit_paisa:    number
    running_balance: number
    invoice_number?: string
    payment_method?: string
  }

  const entries: Omit<LedgerEntry, 'running_balance'>[] = []

  // Purchases = debit (we owe supplier more)
  for (const purchase of purchasesData ?? []) {
    const total = (purchase.items ?? []).reduce(
      (sum: number, item: {
        quantity_trays: number
        price_per_tray_paisa: number
      }) => sum + item.quantity_trays * item.price_per_tray_paisa,
      0
    )
    entries.push({
      id:             purchase.id,
      entry_type:     'purchase',
      entry_date:     purchase.purchase_date,
      description:    `Purchase — ${purchase.invoice_number}`,
      debit_paisa:    total,
      credit_paisa:   0,
      invoice_number: purchase.invoice_number ?? undefined,
    })
  }

  // Payments = credit (reduces what we owe)
  for (const payment of paymentsData ?? []) {
    entries.push({
      id:             payment.id,
      entry_type:     'payment',
      entry_date:     payment.payment_date,
      description:    payment.notes
        ? `Payment — ${payment.notes}`
        : 'Payment to supplier',
      debit_paisa:    0,
      credit_paisa:   payment.amount_paisa,
      payment_method: payment.payment_method ?? undefined,
    })
  }

  // Sort by date; payments before purchases on same day
  entries.sort((a, b) => {
    if (a.entry_date !== b.entry_date) {
      return a.entry_date.localeCompare(b.entry_date)
    }
    if (a.entry_type === 'payment' && b.entry_type === 'purchase') return -1
    if (a.entry_type === 'purchase' && b.entry_type === 'payment') return 1
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
