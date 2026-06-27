import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { generateInvoiceNumber } from '@/lib/utils'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)

  const status     = searchParams.get('status')
  const customerId = searchParams.get('customer_id')
  const from       = searchParams.get('from')
  const to         = searchParams.get('to')

  let query = supabase
    .from('sales')
    .select(`
      *,
      customer:customers(id, contact_name, business_name, phone),
      items:sale_items(
        id,
        quantity_trays,
        price_per_tray_paisa,
        cost_per_tray_paisa,
        egg_category:egg_categories(id, name)
      )
    `)
    .order('sale_date',   { ascending: false })
    .order('created_at',  { ascending: false })

  if (status)     query = query.eq('payment_status', status)
  if (customerId) query = query.eq('customer_id', customerId)
  if (from)       query = query.gte('sale_date', from)
  if (to)         query = query.lte('sale_date', to)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const enriched = (data ?? []).map(s => ({
    ...s,
    total_paisa: (s.items ?? []).reduce(
      (sum: number, item: {
        quantity_trays: number
        price_per_tray_paisa: number
      }) => sum + item.quantity_trays * item.price_per_tray_paisa,
      0
    ),
  }))

  return NextResponse.json(enriched)
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const body = await request.json()

  const {
    customer_id,
    sale_date,
    payment_status,
    notes,
    items,
  } = body

  // Validate
  if (!customer_id) {
    return NextResponse.json(
      { error: 'Customer is required' },
      { status: 400 }
    )
  }
  if (!sale_date) {
    return NextResponse.json(
      { error: 'Sale date is required' },
      { status: 400 }
    )
  }
  if (!items || items.length === 0) {
    return NextResponse.json(
      { error: 'At least one item is required' },
      { status: 400 }
    )
  }
  for (const item of items) {
    if (!item.egg_category_id || !item.quantity_trays || !item.price_per_tray_paisa) {
      return NextResponse.json(
        { error: 'Each item needs category, quantity, and price' },
        { status: 400 }
      )
    }
  }

  // Get average cost per category for COGS
  // We use the average purchase price from purchase_items
  const categoryIds = [...new Set(items.map((i: { egg_category_id: string }) =>
    i.egg_category_id
  ))]

  const { data: costData } = await supabase
    .from('purchase_items')
    .select('egg_category_id, price_per_tray_paisa')
    .in('egg_category_id', categoryIds)

  // Compute average cost per category
  const avgCosts: Record<string, number> = {}
  for (const categoryId of categoryIds) {
    const rows = (costData ?? []).filter(
      r => r.egg_category_id === categoryId
    )
    if (rows.length > 0) {
      const avg = rows.reduce(
        (sum, r) => sum + r.price_per_tray_paisa, 0
      ) / rows.length
      avgCosts[categoryId as string] = Math.round(avg)
    } else {
      avgCosts[categoryId as string] = 0
    }
  }

  const invoice_number = generateInvoiceNumber('SAL')

  // Insert sale
  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .insert({
      customer_id,
      sale_date,
      invoice_number,
      notes:          notes          || null,
      payment_status: payment_status || 'unpaid',
      created_by:     user?.id       || null,
    })
    .select()
    .single()

  if (saleError) {
    return NextResponse.json(
      { error: saleError.message },
      { status: 500 }
    )
  }

  // Insert sale items
  const itemRows = items.map((item: {
    egg_category_id:      string
    quantity_trays:       number
    price_per_tray_paisa: number
  }) => ({
    sale_id:              sale.id,
    egg_category_id:      item.egg_category_id,
    quantity_trays:       item.quantity_trays,
    price_per_tray_paisa: item.price_per_tray_paisa,
    cost_per_tray_paisa:  avgCosts[item.egg_category_id] ?? 0,
  }))

  const { error: itemsError } = await supabase
    .from('sale_items')
    .insert(itemRows)

  if (itemsError) {
    await supabase.from('sales').delete().eq('id', sale.id)
    return NextResponse.json(
      { error: itemsError.message },
      { status: 500 }
    )
  }

  // Insert stock movements (sale_out per item)
  const movementRows = items.map((item: {
    egg_category_id: string
    quantity_trays:  number
  }) => ({
    egg_category_id: item.egg_category_id,
    movement_type:   'sale_out',
    quantity_trays:  item.quantity_trays,
    reference_id:    sale.id,
    notes:           `Sale ${invoice_number}`,
    movement_date:   sale_date,
    created_by:      user?.id || null,
  }))

  const { error: movementsError } = await supabase
    .from('stock_movements')
    .insert(movementRows)

  if (movementsError) {
    await supabase.from('sales').delete().eq('id', sale.id)
    return NextResponse.json(
      { error: movementsError.message },
      { status: 500 }
    )
  }

  return NextResponse.json(sale, { status: 201 })
}
