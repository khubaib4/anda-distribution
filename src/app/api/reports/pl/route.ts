import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)

  const today     = new Date().toISOString().split('T')[0]
  const monthStart = today.slice(0, 7) + '-01'

  const from = searchParams.get('from') || monthStart
  const to   = searchParams.get('to')   || today

  // 1. Revenue — sum of all sale_items in date range
  const { data: salesData } = await supabase
    .from('sales')
    .select(`
      id,
      sale_date,
      items:sale_items(
        quantity_trays,
        price_per_tray_paisa,
        cost_per_tray_paisa,
        egg_category:egg_categories(name)
      )
    `)
    .gte('sale_date', from)
    .lte('sale_date', to)

  // Revenue and COGS per category
  const categoryMap: Record<string, {
    name:          string
    revenue_paisa: number
    cogs_paisa:    number
    quantity_trays: number
  }> = {}

  let totalRevenue = 0
  let totalCOGS    = 0

  for (const sale of salesData ?? []) {
    for (const item of (sale.items ?? []) as unknown as Array<{
      quantity_trays: number
      price_per_tray_paisa: number
      cost_per_tray_paisa: number
      egg_category: { name: string } | { name: string }[] | null
    }>) {
      const revenue = item.quantity_trays * item.price_per_tray_paisa
      const cogs    = item.quantity_trays * item.cost_per_tray_paisa
      const ec      = item.egg_category
      const catName = (Array.isArray(ec) ? ec[0]?.name : ec?.name) ?? 'Unknown'

      if (!categoryMap[catName]) {
        categoryMap[catName] = {
          name:           catName,
          revenue_paisa:  0,
          cogs_paisa:     0,
          quantity_trays: 0,
        }
      }

      categoryMap[catName].revenue_paisa  += revenue
      categoryMap[catName].cogs_paisa     += cogs
      categoryMap[catName].quantity_trays += item.quantity_trays

      totalRevenue += revenue
      totalCOGS    += cogs
    }
  }

  const grossProfit = totalRevenue - totalCOGS

  // 2. Operating expenses by category
  const { data: expensesData } = await supabase
    .from('expenses')
    .select(`
      amount_paisa,
      category:expense_categories(name, icon)
    `)
    .gte('expense_date', from)
    .lte('expense_date', to)

  const expenseMap: Record<string, {
    name:         string
    icon:         string
    total_paisa:  number
  }> = {}

  let totalExpenses = 0

  for (const expense of (expensesData ?? []) as unknown as Array<{
    amount_paisa: number
    category: { name: string; icon: string } | { name: string; icon: string }[] | null
  }>) {
    const cat = expense.category
    const catName = (Array.isArray(cat) ? cat[0]?.name : cat?.name) ?? 'Other'
    const icon    = (Array.isArray(cat) ? cat[0]?.icon : cat?.icon) ?? '📋'

    if (!expenseMap[catName]) {
      expenseMap[catName] = { name: catName, icon, total_paisa: 0 }
    }

    expenseMap[catName].total_paisa += expense.amount_paisa
    totalExpenses                   += expense.amount_paisa
  }

  const netProfit = grossProfit - totalExpenses

  // 3. Purchase total for the period
  const { data: purchasesData } = await supabase
    .from('purchases')
    .select(`items:purchase_items(quantity_trays, price_per_tray_paisa)`)
    .gte('purchase_date', from)
    .lte('purchase_date', to)

  const totalPurchases = (purchasesData ?? []).reduce((sum, p) => {
    return sum + (p.items ?? []).reduce(
      (s: number, i: { quantity_trays: number; price_per_tray_paisa: number }) =>
        s + i.quantity_trays * i.price_per_tray_paisa, 0
    )
  }, 0)

  // 4. Sales count and quantity
  const totalSalesCount  = (salesData ?? []).length
  const totalSalesTrays  = Object.values(categoryMap).reduce(
    (s, c) => s + c.quantity_trays, 0
  )

  return NextResponse.json({
    period: { from, to },
    revenue: {
      total_paisa:  totalRevenue,
      sales_count:  totalSalesCount,
      total_trays:  totalSalesTrays,
      by_category:  Object.values(categoryMap).sort(
        (a, b) => b.revenue_paisa - a.revenue_paisa
      ),
    },
    cogs: {
      total_paisa: totalCOGS,
    },
    gross_profit: {
      total_paisa: grossProfit,
      margin_pct:  totalRevenue > 0
        ? Math.round((grossProfit / totalRevenue) * 100)
        : 0,
    },
    expenses: {
      total_paisa:  totalExpenses,
      by_category:  Object.values(expenseMap).sort(
        (a, b) => b.total_paisa - a.total_paisa
      ),
    },
    net_profit: {
      total_paisa: netProfit,
      margin_pct:  totalRevenue > 0
        ? Math.round((netProfit / totalRevenue) * 100)
        : 0,
    },
    purchases: {
      total_paisa: totalPurchases,
    },
  })
}
