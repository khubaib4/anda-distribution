import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq } from '@/lib/tenant-api'
import { computeSaleSubtotalPaisa } from '@/lib/utils'

const IN_TYPES  = new Set(['purchase_in', 'adjustment_in', 'opening_stock'])
const OUT_TYPES = new Set(['sale_out', 'adjustment_out'])

function movementEggs(quantity_eggs: number | null, quantity_trays: number | null): number {
  return quantity_eggs ?? (quantity_trays ?? 0) * 30
}

function saleTotalPaisa(sale: {
  discount_amount_paisa?: number
  items?: Array<{
    quantity_trays: number
    price_per_tray_paisa: number
    discounted_price_paisa?: number
  }>
}): number {
  const subtotal = computeSaleSubtotalPaisa(sale.items ?? [])
  return subtotal - (sale.discount_amount_paisa ?? 0)
}

export async function GET(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const supabase = await createClient()
  const today    = new Date().toISOString().split('T')[0]
  const monthStart = today.slice(0, 7) + '-01'

  // 1. Today's sales total
  const { data: todaySales } = await tenantEq(
    supabase
      .from('sales')
      .select(`
        id,
        payment_status,
        items:sale_items(quantity_trays, price_per_tray_paisa)
      `)
      .eq('sale_date', today),
    tenantId,
  )

  const todaySalesTotal = (todaySales ?? []).reduce((sum, sale) => {
    return sum + (sale.items ?? []).reduce(
      (s: number, i: { quantity_trays: number; price_per_tray_paisa: number }) =>
        s + i.quantity_trays * i.price_per_tray_paisa, 0
    )
  }, 0)

  const todaySalesCount = (todaySales ?? []).length

  // 2. Today's expenses total
  const { data: todayExpenses } = await tenantEq(
    supabase
      .from('expenses')
      .select('amount_paisa')
      .eq('expense_date', today),
    tenantId,
  )

  const todayExpensesTotal = (todayExpenses ?? []).reduce(
    (sum, e) => sum + e.amount_paisa, 0
  )

  // 3. Total receivables (active customers)
  const { data: customers } = await tenantEq(
    supabase
      .from('customers')
      .select('id')
      .eq('is_active', true),
    tenantId,
  )

  const { data: salesForBalances } = await tenantEq(
    supabase
      .from('sales')
      .select(`
        customer_id,
        discount_amount_paisa,
        items:sale_items(
          quantity_trays,
          price_per_tray_paisa,
          discounted_price_paisa
        )
      `),
    tenantId,
  )

  const { data: paymentsForBalances } = await tenantEq(
    supabase.from('customer_payments').select('customer_id, amount_paisa'),
    tenantId,
  )

  const salesByCustomer: Record<string, number> = {}
  for (const sale of salesForBalances ?? []) {
    const total = saleTotalPaisa(sale)
    salesByCustomer[sale.customer_id] =
      (salesByCustomer[sale.customer_id] ?? 0) + total
  }

  const paymentsByCustomer: Record<string, number> = {}
  for (const payment of paymentsForBalances ?? []) {
    paymentsByCustomer[payment.customer_id] =
      (paymentsByCustomer[payment.customer_id] ?? 0) + payment.amount_paisa
  }

  const balances = (customers ?? []).map(c => ({
    balance_paisa:
      (salesByCustomer[c.id] ?? 0) - (paymentsByCustomer[c.id] ?? 0),
  }))

  const totalReceivables = balances.reduce(
    (sum, b) => sum + Math.max(0, b.balance_paisa), 0
  )

  const customersWithBalance = balances.filter(
    b => b.balance_paisa > 0
  ).length

  // 4. Current stock
  const { data: categories } = await tenantEq(
    supabase
      .from('egg_categories')
      .select('id, name, display_order')
      .eq('is_active', true),
    tenantId,
  ).order('display_order')

  const { data: movements } = await tenantEq(
    supabase
      .from('stock_movements')
      .select('egg_category_id, movement_type, quantity_eggs, quantity_trays'),
    tenantId,
  )

  const stockByCategory = new Map<string, number>()
  for (const m of movements ?? []) {
    const eggs = movementEggs(m.quantity_eggs, m.quantity_trays)
    const current = stockByCategory.get(m.egg_category_id) ?? 0

    if (IN_TYPES.has(m.movement_type)) {
      stockByCategory.set(m.egg_category_id, current + eggs)
    } else if (OUT_TYPES.has(m.movement_type)) {
      stockByCategory.set(m.egg_category_id, current - eggs)
    }
  }

  const stock = (categories ?? []).map(cat => {
    const quantity_eggs  = stockByCategory.get(cat.id) ?? 0
    const quantity_trays = quantity_eggs / 30

    return {
      egg_category_id: cat.id,
      egg_category:    cat.name,
      quantity_eggs,
      quantity_trays,
      display_order:   cat.display_order,
    }
  })

  const totalStockTrays = stock.reduce(
    (sum, s) => sum + s.quantity_trays, 0
  )

  // 5. This month's sales
  const { data: monthSales } = await tenantEq(
    supabase
      .from('sales')
      .select(`items:sale_items(quantity_trays, price_per_tray_paisa)`)
      .gte('sale_date', monthStart)
      .lte('sale_date', today),
    tenantId,
  )

  const monthSalesTotal = (monthSales ?? []).reduce((sum, sale) => {
    return sum + (sale.items ?? []).reduce(
      (s: number, i: { quantity_trays: number; price_per_tray_paisa: number }) =>
        s + i.quantity_trays * i.price_per_tray_paisa, 0
    )
  }, 0)

  // 6. This month's expenses
  const { data: monthExpenses } = await tenantEq(
    supabase
      .from('expenses')
      .select('amount_paisa')
      .gte('expense_date', monthStart)
      .lte('expense_date', today),
    tenantId,
  )

  const monthExpensesTotal = (monthExpenses ?? []).reduce(
    (sum, e) => sum + e.amount_paisa, 0
  )

  // 7. This month's purchases total
  const { data: monthPurchases } = await tenantEq(
    supabase
      .from('purchases')
      .select(`items:purchase_items(quantity_trays, price_per_tray_paisa)`)
      .gte('purchase_date', monthStart)
      .lte('purchase_date', today),
    tenantId,
  )

  const monthPurchasesTotal = (monthPurchases ?? []).reduce((sum, p) => {
    return sum + (p.items ?? []).reduce(
      (s: number, i: { quantity_trays: number; price_per_tray_paisa: number }) =>
        s + i.quantity_trays * i.price_per_tray_paisa, 0
    )
  }, 0)

  // 8. Recent sales (last 5)
  const { data: recentSales } = await tenantEq(
    supabase
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
      .limit(5),
    tenantId,
  )

  const recentSalesEnriched = (recentSales ?? []).map(s => ({
    ...s,
    total_paisa: (s.items ?? []).reduce(
      (sum: number, i: { quantity_trays: number; price_per_tray_paisa: number }) =>
        sum + i.quantity_trays * i.price_per_tray_paisa, 0
    ),
  }))

  const { data: overdueSales, error: overdueError } = await tenantEq(
    supabase
      .from('sales')
      .select('id')
      .in('payment_status', ['unpaid', 'partial'])
      .not('due_date', 'is', null)
      .lt('due_date', today),
    tenantId,
  )

  if (overdueError) {
    return NextResponse.json({ error: overdueError.message }, { status: 500 })
  }

  const overdueCount = overdueSales?.length ?? 0

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
      items:       stock,
      total_trays: totalStockTrays,
    },
    recent_sales: recentSalesEnriched,
    alerts: {
      overdue_count: overdueCount,
    },
  })
}
