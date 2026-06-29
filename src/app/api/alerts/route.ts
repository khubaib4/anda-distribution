import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq } from '@/lib/tenant-api'

function saleTotalPaisa(
  items: Array<{ quantity_trays: number; price_per_tray_paisa: number }>,
): number {
  return (items ?? []).reduce(
    (sum, i) => sum + i.quantity_trays * i.price_per_tray_paisa,
    0,
  )
}

function daysOverdue(dueDate: string, today: string): number {
  const dueMs   = new Date(`${dueDate}T00:00:00`).getTime()
  const todayMs = new Date(`${today}T00:00:00`).getTime()
  return Math.floor((todayMs - dueMs) / 86_400_000)
}

function mapOverdueSale(
  sale: {
    id: string
    sale_date: string
    due_date: string
    invoice_number: string | null
    payment_status: string
    customer_id: string
    amount_paid_paisa: number
    customer: { contact_name: string; business_name: string | null; phone: string | null }
      | { contact_name: string; business_name: string | null; phone: string | null }[]
      | null
    items: Array<{ quantity_trays: number; price_per_tray_paisa: number }>
  },
  today: string,
  days_overdue: number,
) {
  const customer = Array.isArray(sale.customer)
    ? sale.customer[0]
    : sale.customer
  const total_paisa = saleTotalPaisa(sale.items ?? [])

  return {
    sale_id:        sale.id,
    invoice_number: sale.invoice_number,
    sale_date:      sale.sale_date,
    due_date:       sale.due_date,
    days_overdue,
    payment_status: sale.payment_status,
    customer_id:    sale.customer_id,
    contact_name:   customer?.contact_name ?? '—',
    business_name:  customer?.business_name ?? null,
    phone:          customer?.phone ?? null,
    balance_paisa:  total_paisa - (sale.amount_paid_paisa ?? 0),
  }
}

export async function GET(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const supabase = await createClient()
  const today    = new Date().toISOString().split('T')[0]

  const saleSelect = `
    id,
    sale_date,
    due_date,
    invoice_number,
    payment_status,
    customer_id,
    amount_paid_paisa,
    customer:customers(contact_name, business_name, phone),
    items:sale_items(quantity_trays, price_per_tray_paisa)
  `

  let overdueQuery = tenantEq(
    supabase
      .from('sales')
      .select(saleSelect)
      .in('payment_status', ['unpaid', 'partial'])
      .not('due_date', 'is', null)
      .lt('due_date', today),
    tenantId,
  ).order('due_date', { ascending: true })

  let dueTodayQuery = tenantEq(
    supabase
      .from('sales')
      .select(saleSelect)
      .eq('due_date', today)
      .in('payment_status', ['unpaid', 'partial']),
    tenantId,
  ).order('created_at', { ascending: false })

  const [
    { data: overdueSales, error: overdueError },
    { data: dueTodaySales, error: dueTodayError },
  ] = await Promise.all([overdueQuery, dueTodayQuery])

  if (overdueError) {
    return NextResponse.json({ error: overdueError.message }, { status: 500 })
  }
  if (dueTodayError) {
    return NextResponse.json({ error: dueTodayError.message }, { status: 500 })
  }

  const overdue = (overdueSales ?? [])
    .map(sale => mapOverdueSale(sale, today, daysOverdue(sale.due_date, today)))
    .sort((a, b) => b.days_overdue - a.days_overdue)

  const due_today = (dueTodaySales ?? []).map(sale =>
    mapOverdueSale(sale, today, 0),
  )

  const overdueCount  = overdue.length
  const dueTodayCount = due_today.length

  return NextResponse.json({
    overdue,
    due_today,
    counts: {
      overdue:   overdueCount,
      due_today: dueTodayCount,
      total:     overdueCount + dueTodayCount,
    },
  })
}
