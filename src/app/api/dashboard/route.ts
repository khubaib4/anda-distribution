import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const today    = new Date().toISOString().split('T')[0]

  // 1. Today's sales total
  const { data: todaySales } = await supabase
    .from('sales')
    .select(`
      id,
      payment_status,
      items:sale_items(quantity_trays, price_per_tray_paisa)
    `)
    .eq('sale_date', today)

  const todaySalesTotal = (todaySales ?? []).reduce((sum, sale) => {
    return sum + (sale.items ?? []).reduce(
      (s: number, i: { quantity_trays: number; price_per_tray_paisa: number }) =>
        s + i.quantity_trays * i.price_per_tray_paisa, 0
    )
  }, 0)

  const todaySalesCount = (todaySales ?? []).length

  // 2. Today's expenses total
  const { data: todayExpenses } = await supabase
    .from('expenses')
    .select('amount_paisa')
    .eq('expense_date', today)

  const todayExpensesTotal = (todayExpenses ?? []).reduce(
    (sum, e) => sum + e.amount_paisa, 0
  )

  // 3. Total receivables (all customers)
  const { data: balances } = await supabase
    .from('customer_balances')
    .select('balance_paisa')
    .eq('is_active', true)

  const totalReceivables = (balances ?? []).reduce(
    (sum, b) => sum + Math.max(0, b.balance_paisa), 0
  )

  const customersWithBalance = (balances ?? []).filter(
    b => b.balance_paisa > 0
  ).length

  // 4. Current stock
  const { data: stock } = await supabase
    .from('current_stock')
    .select('*')
    .order('display_order')

  const totalStockTrays = (stock ?? []).reduce(
    (sum, s) => sum + s.quantity_trays, 0
  )

  // 5. This month's sales
  const monthStart = today.slice(0, 7) + '-01'
  const { data: monthSales } = await supabase
    .from('sales')
    .select(`items:sale_items(quantity_trays, price_per_tray_paisa)`)
    .gte('sale_date', monthStart)
    .lte('sale_date', today)

  const monthSalesTotal = (monthSales ?? []).reduce((sum, sale) => {
    return sum + (sale.items ?? []).reduce(
      (s: number, i: { quantity_trays: number; price_per_tray_paisa: number }) =>
        s + i.quantity_trays * i.price_per_tray_paisa, 0
    )
  }, 0)

  // 6. This month's expenses
  const { data: monthExpenses } = await supabase
    .from('expenses')
    .select('amount_paisa')
    .gte('expense_date', monthStart)
    .lte('expense_date', today)

  const monthExpensesTotal = (monthExpenses ?? []).reduce(
    (sum, e) => sum + e.amount_paisa, 0
  )

  // 7. This month's purchases total
  const { data: monthPurchases } = await supabase
    .from('purchases')
    .select(`items:purchase_items(quantity_trays, price_per_tray_paisa)`)
    .gte('purchase_date', monthStart)
    .lte('purchase_date', today)

  const monthPurchasesTotal = (monthPurchases ?? []).reduce((sum, p) => {
    return sum + (p.items ?? []).reduce(
      (s: number, i: { quantity_trays: number; price_per_tray_paisa: number }) =>
        s + i.quantity_trays * i.price_per_tray_paisa, 0
    )
  }, 0)

  // 8. Recent sales (last 5)
  const { data: recentSales } = await supabase
    .from('sales')
    .select(`
      id,
      sale_date,
      invoice_number,
      payment_status,
      customer:customers(contact_name, business_name),
      items:sale_items(quantity_trays, price_per_tray_paisa)
    `)
    .order('sale_date',  { ascending: false })
    .order('created_at', { ascending: false })
    .limit(5)

  const recentSalesEnriched = (recentSales ?? []).map(s => ({
    ...s,
    total_paisa: (s.items ?? []).reduce(
      (sum: number, i: { quantity_trays: number; price_per_tray_paisa: number }) =>
        sum + i.quantity_trays * i.price_per_tray_paisa, 0
    ),
  }))

  const { count: overdueCount, error: overdueError } = await supabase
    .from('overdue_sales')
    .select('*', { count: 'exact', head: true })

  if (overdueError) {
    return NextResponse.json({ error: overdueError.message }, { status: 500 })
  }

  return NextResponse.json({
    today: {
      sales_total:    todaySalesTotal,
      sales_count:    todaySalesCount,
      expenses_total: todayExpensesTotal,
      date:           today,
    },
    month: {
      sales_total:     monthSalesTotal,
      expenses_total:  monthExpensesTotal,
      purchases_total: monthPurchasesTotal,
      gross_profit:    monthSalesTotal - monthPurchasesTotal,
      net_profit:      monthSalesTotal - monthPurchasesTotal - monthExpensesTotal,
    },
    receivables: {
      total_paisa:           totalReceivables,
      customers_with_balance: customersWithBalance,
    },
    stock: {
      items:        stock ?? [],
      total_trays:  totalStockTrays,
    },
    recent_sales: recentSalesEnriched,
    alerts: {
      overdue_count: overdueCount ?? 0,
    },
  })
}
