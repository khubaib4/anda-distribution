import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq } from '@/lib/tenant-api'
import { computeSaleSubtotalPaisa, computeSaleTotalPaisa } from '@/lib/utils'

const IN_TYPES = ['purchase_in', 'adjustment_in', 'opening_stock'] as const

function movementEggs(
  quantity_eggs: number | null,
  quantity_trays: number | null,
): number {
  if ((quantity_eggs ?? 0) > 0) return quantity_eggs!
  return (quantity_trays ?? 0) * 30
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
        discount_amount_paisa,
        items:sale_items(
          quantity_trays,
          price_per_tray_paisa,
          discounted_price_paisa
        )
      `)
      .eq('sale_date', today),
    tenantId,
  )

  const todaySalesTotal = (todaySales ?? []).reduce(
    (sum, sale) => sum + computeSaleTotalPaisa(sale),
    0,
  )

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
    const total = computeSaleTotalPaisa(sale)
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

  const stockMap: Record<string, number> = {}

  for (const movement of movements ?? []) {
    const eggs = movementEggs(movement.quantity_eggs, movement.quantity_trays)
    const isIn = IN_TYPES.includes(
      movement.movement_type as (typeof IN_TYPES)[number],
    )

    if (!stockMap[movement.egg_category_id]) {
      stockMap[movement.egg_category_id] = 0
    }

    stockMap[movement.egg_category_id] += isIn ? eggs : -eggs
  }

  const stock = (categories ?? []).map(cat => {
    const quantity_eggs  = stockMap[cat.id] ?? 0
    const quantity_trays = quantity_eggs / 30

    return {
      egg_category_id: cat.id,
      egg_category:    cat.name,
      quantity_eggs,
      quantity_trays,
      display_order:   cat.display_order,
    }
  })

  const totalEggs = stock.reduce((sum, s) => sum + s.quantity_eggs, 0)
  const totalStockTrays = totalEggs / 30

  // 5. This month's sales and COGS
  const { data: monthSales } = await tenantEq(
    supabase
      .from('sales')
      .select(`
        discount_amount_paisa,
        items:sale_items(
          quantity_trays,
          price_per_tray_paisa,
          discounted_price_paisa,
          cost_per_tray_paisa
        )
      `)
      .gte('sale_date', monthStart)
      .lte('sale_date', today),
    tenantId,
  )

  let monthSalesTotal = 0
  let monthCOGS       = 0

  for (const sale of monthSales ?? []) {
    monthSalesTotal += computeSaleTotalPaisa(sale)
    for (const item of (sale.items ?? []) as Array<{
      quantity_trays: number
      cost_per_tray_paisa: number
    }>) {
      monthCOGS += item.quantity_trays * item.cost_per_tray_paisa
    }
  }

  const monthGrossProfit = monthSalesTotal - monthCOGS

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

  // 7. Recent sales (last 5)
  const { data: recentSales } = await tenantEq(
    supabase
      .from('sales')
      .select(`
        id,
        sale_date,
        invoice_number,
        payment_status,
        discount_amount_paisa,
        customer:customers(contact_name, business_name),
        items:sale_items(
          quantity_trays,
          price_per_tray_paisa,
          discounted_price_paisa
        )
      `)
      .order('sale_date',  { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5),
    tenantId,
  )

  const recentSalesEnriched = (recentSales ?? []).map(s => ({
    ...s,
    total_paisa: computeSaleTotalPaisa(s),
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
      sales_total:    monthSalesTotal,
      cogs_total:     monthCOGS,
      gross_profit:   monthGrossProfit,
      expenses_total: monthExpensesTotal,
      net_profit:     monthGrossProfit - monthExpensesTotal,
    },
    receivables: {
      total_paisa:           totalReceivables,
      customers_with_balance: customersWithBalance,
    },
    stock: {
      items:       stock,
      total_trays: totalStockTrays,
      total_eggs:  totalEggs,
    },
    recent_sales: recentSalesEnriched,
    alerts: {
      overdue_count: overdueCount,
    },
  })
}
