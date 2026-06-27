import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { generateInvoiceNumber } from '@/lib/utils'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)

  const status     = searchParams.get('status')
  const supplierId = searchParams.get('supplier_id')
  const from       = searchParams.get('from')
  const to         = searchParams.get('to')

  let query = supabase
    .from('purchases')
    .select(`
      *,
      supplier:suppliers(id, name),
      items:purchase_items(
        id,
        quantity_trays,
        price_per_tray_paisa,
        egg_category:egg_categories(id, name)
      )
    `)
    .order('purchase_date', { ascending: false })
    .order('created_at',    { ascending: false })

  if (status)     query = query.eq('payment_status', status)
  if (supplierId) query = query.eq('supplier_id', supplierId)
  if (from)       query = query.gte('purchase_date', from)
  if (to)         query = query.lte('purchase_date', to)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Compute total_paisa for each purchase
  const enriched = (data ?? []).map(p => ({
    ...p,
    total_paisa: (p.items ?? []).reduce(
      (sum: number, item: { quantity_trays: number; price_per_tray_paisa: number }) =>
        sum + item.quantity_trays * item.price_per_tray_paisa,
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
    supplier_id,
    supplier_name,
    purchase_date,
    notes,
    payment_status,
    amount_paid_paisa,
    items,
  } = body

  // Validate
  if (!purchase_date) {
    return NextResponse.json(
      { error: 'Purchase date is required' },
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

  const invoice_number = generateInvoiceNumber('PUR')

  // Insert purchase
  const { data: purchase, error: purchaseError } = await supabase
    .from('purchases')
    .insert({
      supplier_id:            supplier_id    || null,
      supplier_name_snapshot: supplier_name  || null,
      purchase_date,
      invoice_number,
      notes:                  notes          || null,
      payment_status:         payment_status || 'unpaid',
      amount_paid_paisa:      amount_paid_paisa || 0,
      created_by:             user?.id       || null,
    })
    .select()
    .single()

  if (purchaseError) {
    return NextResponse.json(
      { error: purchaseError.message },
      { status: 500 }
    )
  }

  // Insert purchase items
  const itemRows = items.map((item: {
    egg_category_id:      string
    quantity_trays:       number
    price_per_tray_paisa: number
  }) => ({
    purchase_id:          purchase.id,
    egg_category_id:      item.egg_category_id,
    quantity_trays:       item.quantity_trays,
    price_per_tray_paisa: item.price_per_tray_paisa,
  }))

  const { error: itemsError } = await supabase
    .from('purchase_items')
    .insert(itemRows)

  if (itemsError) {
    // Rollback purchase
    await supabase.from('purchases').delete().eq('id', purchase.id)
    return NextResponse.json(
      { error: itemsError.message },
      { status: 500 }
    )
  }

  // Insert stock movements (one per item)
  const movementRows = items.map((item: {
    egg_category_id: string
    quantity_trays:  number
  }) => ({
    egg_category_id: item.egg_category_id,
    movement_type:   'purchase_in',
    quantity_trays:  item.quantity_trays,
    reference_id:    purchase.id,
    notes:           `Purchase ${invoice_number}`,
    movement_date:   purchase_date,
    created_by:      user?.id || null,
  }))

  const { error: movementsError } = await supabase
    .from('stock_movements')
    .insert(movementRows)

  if (movementsError) {
    // Rollback purchase + items
    await supabase.from('purchases').delete().eq('id', purchase.id)
    return NextResponse.json(
      { error: movementsError.message },
      { status: 500 }
    )
  }

  return NextResponse.json(purchase, { status: 201 })
}
