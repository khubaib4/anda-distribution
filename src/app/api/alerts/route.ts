import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const today    = new Date().toISOString().split('T')[0]

  const [
    { data: overdue, error: overdueError },
    { data: dueTodaySales, error: dueTodayError },
  ] = await Promise.all([
    supabase
      .from('overdue_sales')
      .select('*')
      .order('days_overdue', { ascending: false }),

    supabase
      .from('sales')
      .select(`
        id,
        sale_date,
        due_date,
        invoice_number,
        payment_status,
        customer_id,
        amount_paid_paisa,
        customer:customers(contact_name, business_name, phone),
        items:sale_items(quantity_trays, price_per_tray_paisa)
      `)
      .eq('due_date', today)
      .in('payment_status', ['unpaid', 'partial'])
      .order('created_at', { ascending: false }),
  ])

  if (overdueError) {
    return NextResponse.json({ error: overdueError.message }, { status: 500 })
  }
  if (dueTodayError) {
    return NextResponse.json({ error: dueTodayError.message }, { status: 500 })
  }

  const due_today = (dueTodaySales ?? []).map(sale => {
    const customer = Array.isArray(sale.customer)
      ? sale.customer[0]
      : sale.customer
    const total_paisa = (sale.items ?? []).reduce(
      (sum: number, i: { quantity_trays: number; price_per_tray_paisa: number }) =>
        sum + i.quantity_trays * i.price_per_tray_paisa,
      0
    )
    return {
      sale_id:        sale.id,
      invoice_number: sale.invoice_number,
      sale_date:      sale.sale_date,
      due_date:       sale.due_date,
      days_overdue:   0,
      payment_status: sale.payment_status,
      customer_id:    sale.customer_id,
      contact_name:   customer?.contact_name ?? '—',
      business_name:  customer?.business_name ?? null,
      phone:          customer?.phone ?? null,
      balance_paisa:  total_paisa - (sale.amount_paid_paisa ?? 0),
    }
  })

  const overdueCount  = (overdue ?? []).length
  const dueTodayCount = due_today.length

  return NextResponse.json({
    overdue:   overdue ?? [],
    due_today,
    counts: {
      overdue:   overdueCount,
      due_today: dueTodayCount,
      total:     overdueCount + dueTodayCount,
    },
  })
}
