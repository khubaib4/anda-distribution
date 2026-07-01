import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'
import { enrichWithPartnerNames } from '@/lib/expense-partners'

export async function GET(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

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

  query = tenantEq(query, tenantId)
  if (status)     query = query.eq('payment_status', status)
  if (supplierId) query = query.eq('supplier_id', supplierId)
  if (from)       query = query.gte('purchase_date', from)
  if (to)         query = query.lte('purchase_date', to)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const enriched = (data ?? []).map(p => ({
    ...p,
    total_paisa: (p.items ?? []).reduce(
      (sum: number, item: { quantity_trays: number; price_per_tray_paisa: number }) =>
        sum + item.quantity_trays * item.price_per_tray_paisa,
      0
    ),
  }))

  const withPartnerNames = await enrichWithPartnerNames(supabase, enriched)
  return NextResponse.json(withPartnerNames)
}

export async function POST(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const writeTenantId = requireWriteTenantId(tenantId, request)
  if (writeTenantId instanceof NextResponse) return writeTenantId

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
    paid_by,
    paid_by_partner_id,
    paid_by_partner_source,
  } = body

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

  const paidBy = paid_by === 'partner' ? 'partner' : 'business'

  if (paidBy === 'partner' && !paid_by_partner_id) {
    return NextResponse.json(
      { error: 'Partner is required when paid by partner' },
      { status: 400 },
    )
  }

  const { count, error: countError } = await supabase
    .from('purchases')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', writeTenantId)

  if (countError) {
    return NextResponse.json(
      { error: countError.message },
      { status: 500 }
    )
  }

  const invoice_number = `PUR-${String((count ?? 0) + 1).padStart(4, '0')}`

  const totalPaisa = items.reduce(
    (sum: number, item: { quantity_trays: number; price_per_tray_paisa: number }) =>
      sum + item.quantity_trays * item.price_per_tray_paisa,
    0,
  )

  const { data: purchase, error: purchaseError } = await supabase
    .from('purchases')
    .insert({
      tenant_id:              writeTenantId,
      supplier_id:            supplier_id    || null,
      supplier_name_snapshot: supplier_name  || null,
      purchase_date,
      invoice_number,
      notes:                  notes          || null,
      payment_status:         payment_status || 'unpaid',
      amount_paid_paisa:      amount_paid_paisa || 0,
      paid_by:                paidBy,
      paid_by_partner_id:     paidBy === 'partner' ? paid_by_partner_id : null,
      paid_by_partner_source: paidBy === 'partner' ? paid_by_partner_source : null,
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

  const itemRows = items.map((item: {
    egg_category_id:      string
    quantity_trays:       number
    price_per_tray_paisa: number
  }) => ({
    tenant_id:            writeTenantId,
    purchase_id:          purchase.id,
    egg_category_id:      item.egg_category_id,
    quantity_trays:       item.quantity_trays,
    price_per_tray_paisa: item.price_per_tray_paisa,
  }))

  const { error: itemsError } = await supabase
    .from('purchase_items')
    .insert(itemRows)

  if (itemsError) {
    await supabase.from('purchases').delete().eq('id', purchase.id)
    return NextResponse.json(
      { error: itemsError.message },
      { status: 500 }
    )
  }

  const movementRows = items.map((item: {
    egg_category_id: string
    quantity_trays:  number
  }) => ({
    tenant_id:       writeTenantId,
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
    await supabase.from('purchases').delete().eq('id', purchase.id)
    return NextResponse.json(
      { error: movementsError.message },
      { status: 500 }
    )
  }

  if (paidBy === 'partner' && paid_by_partner_id) {
    const capitalInsert: Record<string, unknown> = {
      tenant_id:        writeTenantId,
      type:             'contribution',
      amount_paisa:     totalPaisa,
      transaction_date: purchase_date,
      notes:            `Paid purchase: ${invoice_number}`,
      reference:        null,
      created_by:       user?.id || null,
    }

    if (paid_by_partner_source === 'partner') {
      capitalInsert.partner_id         = null
      capitalInsert.partner_profile_id = paid_by_partner_id
    } else {
      capitalInsert.partner_id         = paid_by_partner_id
      capitalInsert.partner_profile_id = null
    }

    const { error: capitalError } = await supabase
      .from('capital_transactions')
      .insert(capitalInsert)

    if (capitalError) {
      return NextResponse.json(
        { error: `Purchase saved but capital entry failed: ${capitalError.message}` },
        { status: 500 },
      )
    }
  }

  return NextResponse.json(purchase, { status: 201 })
}
