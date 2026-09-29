import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq } from '@/lib/tenant-api'
import { computeSaleTotalPaisa } from '@/lib/utils'
import { businessDateString, calendarDaysBetween } from '@/lib/business-date'

function daysOverdue(dueDate: string, today: string): number {
  return calendarDaysBetween(dueDate, today)
}

function mapOverdueSale(
  sale: {
    id: string
    sale_date: string
    due_date: string
    invoice_number: string | null
    payment_status: string
    customer_id: string
    amount_paid_paisa: number | null
    discount_amount_paisa: number | null
    customer: { contact_name: string; business_name: string | null; phone: string | null }
      | { contact_name: string; business_name: string | null; phone: string | null }[]
      | null
    items: Array<{
      quantity_trays: number
      price_per_tray_paisa: number
      discount_type: 'percentage' | 'fixed' | null
      discount_value: number | null
      discounted_price_paisa: number | null
    }>
  },
  today: string,
  days_overdue: number,
) {
  const customer = Array.isArray(sale.customer)
    ? sale.customer[0]
    : sale.customer
  const total_paisa = computeSaleTotalPaisa(sale)
  const duePaisa = Math.max(0, total_paisa - (sale.amount_paid_paisa ?? 0))

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
    balance_paisa:  duePaisa,
  }
}

export async function GET(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const supabase = await createClient()
  const today    = businessDateString()

  const saleSelect = `
    id,
    sale_date,
    due_date,
    invoice_number,
    payment_status,
    customer_id,
    amount_paid_paisa,
    discount_amount_paisa,
    customer:customers(contact_name, business_name, phone),
    items:sale_items(
      quantity_trays,
      price_per_tray_paisa,
      discount_type,
      discount_value,
      discounted_price_paisa
    )
  `

  const overdueQuery = tenantEq(
    supabase
      .from('sales')
      .select(saleSelect)
      .in('payment_status', ['unpaid', 'partial'])
      .not('due_date', 'is', null)
      .lt('due_date', today),
    tenantId,
  ).order('due_date', { ascending: true })

  const dueTodayQuery = tenantEq(
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
    .filter(sale => sale.balance_paisa > 0)
    .sort((a, b) => b.days_overdue - a.days_overdue)

  const due_today = (dueTodaySales ?? [])
    .map(sale => mapOverdueSale(sale, today, 0))
    .filter(sale => sale.balance_paisa > 0)

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
