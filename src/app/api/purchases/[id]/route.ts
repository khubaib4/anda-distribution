import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, requireWriteTenantId } from '@/lib/tenant-api'
import { enrichWithPartnerNames } from '@/lib/expense-partners'
import { validatePurchaseEditStockAvailability } from '@/lib/stock-availability'

const PURCHASE_SELECT = `
  *,
  supplier:suppliers(id, name, phone),
  items:purchase_items(
    id,
    egg_category_id,
    quantity_trays,
    price_per_tray_paisa,
    egg_category:egg_categories(id, name)
  )
`

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const { id } = await params
  const supabase = await createClient()

  let query = supabase
    .from('purchases')
    .select(PURCHASE_SELECT)
    .eq('id', id)
  if (tenantId) query = query.eq('tenant_id', tenantId)

  const { data, error } = await query.single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const enriched = {
    ...data,
    total_paisa: (data.items ?? []).reduce(
      (sum: number, item: { quantity_trays: number; price_per_tray_paisa: number }) =>
        sum + item.quantity_trays * item.price_per_tray_paisa,
      0
    ),
  }

  const [withPartnerName] = await enrichWithPartnerNames(supabase, [enriched])
  return NextResponse.json(withPartnerName)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const writeTenantId = requireWriteTenantId(tenantId, request)
  if (writeTenantId instanceof NextResponse) return writeTenantId

  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const body = await request.json()

  const paymentFields = [
    'payment_status',
    'amount_paid_paisa',
    'payment_method',
    'bank_account_id',
    'paid_by',
    'paid_by_partner_id',
    'paid_by_partner_source',
  ]
  if (paymentFields.some(field => Object.prototype.hasOwnProperty.call(body, field))) {
    return NextResponse.json(
      { error: 'Purchase payment status is managed by supplier payments. Record payments from the supplier profile.' },
      { status: 400 },
    )
  }

  const {
    supplier_id,
    supplier_name,
    purchase_date,
    notes,
    items,
  } = body

  const { data: existing, error: fetchError } = await supabase
    .from('purchases')
    .select(`
      id,
      invoice_number,
      purchase_date,
      supplier_id,
      supplier_name_snapshot,
      payment_status,
      amount_paid_paisa,
      paid_by,
      paid_by_partner_id,
      paid_by_partner_source
    `)
    .eq('id', id)
    .eq('tenant_id', writeTenantId)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })
  }

  const hasPaymentHistory =
    existing.payment_status !== 'unpaid' ||
    (existing.amount_paid_paisa ?? 0) !== 0 ||
    existing.paid_by === 'partner' ||
    existing.paid_by_partner_id !== null ||
    existing.paid_by_partner_source !== null

  if (supplier_id !== undefined) {
    if (supplier_id !== null && supplier_id !== '' && typeof supplier_id !== 'string') {
      return NextResponse.json({ error: 'Invalid supplier' }, { status: 400 })
    }

    const nextSupplierId = supplier_id || null
    if (nextSupplierId !== existing.supplier_id && hasPaymentHistory) {
      return NextResponse.json(
        { error: 'Cannot change the supplier on a purchase with payment or partner settlement history.' },
        { status: 409 },
      )
    }

    if (nextSupplierId) {
      const { data: supplier, error: supplierError } = await supabase
        .from('suppliers')
        .select('id')
        .eq('id', nextSupplierId)
        .eq('tenant_id', writeTenantId)
        .maybeSingle()

      if (supplierError) {
        return NextResponse.json({ error: supplierError.message }, { status: 500 })
      }
      if (!supplier) {
        return NextResponse.json({ error: 'Supplier not found' }, { status: 400 })
      }
    }
  }

  if (
    existing.supplier_id === null &&
    (supplier_id === undefined || supplier_id === null || supplier_id === '') &&
    supplier_name !== undefined &&
    (supplier_name || null) !== existing.supplier_name_snapshot &&
    hasPaymentHistory
  ) {
    return NextResponse.json(
      { error: 'Cannot change the supplier on a purchase with payment or partner settlement history.' },
      { status: 409 },
    )
  }

  if (items !== undefined) {
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'At least one item is required' },
        { status: 400 },
      )
    }

    for (const item of items) {
      if (
        typeof item.price_per_tray_paisa !== 'number' ||
        !Number.isFinite(item.price_per_tray_paisa) ||
        item.price_per_tray_paisa <= 0
      ) {
        return NextResponse.json(
          { error: 'Each item needs category, quantity, and price' },
          { status: 400 },
        )
      }
    }

    const stockAvailability = await validatePurchaseEditStockAvailability({
      supabase,
      tenantId: writeTenantId,
      purchaseId: id,
      items,
    })

    if (stockAvailability.invalidItems.length > 0) {
      return NextResponse.json(
        {
          error: 'Invalid purchase stock request',
          invalid_items: stockAvailability.invalidItems,
        },
        { status: 400 },
      )
    }

    if (!stockAvailability.ok) {
      return NextResponse.json(
        {
          error: 'Insufficient stock',
          insufficient_stock: stockAvailability.insufficientStock,
        },
        { status: 409 },
      )
    }
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (supplier_id       !== undefined) updates.supplier_id            = supplier_id || null
  if (supplier_name     !== undefined) updates.supplier_name_snapshot = supplier_name || null
  if (purchase_date     !== undefined) updates.purchase_date          = purchase_date
  if (notes             !== undefined) updates.notes                  = notes || null

  const { error: updateError } = await supabase
    .from('purchases')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', writeTenantId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  const movementDate = purchase_date ?? existing.purchase_date
  const invoiceNumber = existing.invoice_number

  if (items !== undefined) {
    const { error: delItemsError } = await supabase
      .from('purchase_items')
      .delete()
      .eq('purchase_id', id)
      .eq('tenant_id', writeTenantId)

    if (delItemsError) {
      return NextResponse.json({ error: delItemsError.message }, { status: 500 })
    }

    const { error: delMovError } = await supabase
      .from('stock_movements')
      .delete()
      .eq('reference_id', id)
      .eq('movement_type', 'purchase_in')
      .eq('tenant_id', writeTenantId)

    if (delMovError) {
      return NextResponse.json({ error: delMovError.message }, { status: 500 })
    }

    const itemRows = items.map((item: {
      egg_category_id:      string
      quantity_trays:       number
      price_per_tray_paisa: number
    }) => ({
      tenant_id:            writeTenantId,
      purchase_id:          id,
      egg_category_id:      item.egg_category_id,
      quantity_trays:       item.quantity_trays,
      price_per_tray_paisa: item.price_per_tray_paisa,
    }))

    const { error: itemsError } = await supabase
      .from('purchase_items')
      .insert(itemRows)

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 })
    }

    const movementRows = items.map((item: {
      egg_category_id: string
      quantity_trays:  number
    }) => ({
      tenant_id:       writeTenantId,
      egg_category_id: item.egg_category_id,
      movement_type:   'purchase_in',
      quantity_trays:  item.quantity_trays,
      reference_id:    id,
      notes:           `Purchase ${invoiceNumber}`,
      movement_date:   movementDate,
      created_by:      user?.id || null,
    }))

    const { error: movementsError } = await supabase
      .from('stock_movements')
      .insert(movementRows)

    if (movementsError) {
      return NextResponse.json({ error: movementsError.message }, { status: 500 })
    }
  }

  const { data, error } = await supabase
    .from('purchases')
    .select(PURCHASE_SELECT)
    .eq('id', id)
    .eq('tenant_id', writeTenantId)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const enriched = {
    ...data,
    total_paisa: (data.items ?? []).reduce(
      (sum: number, item: { quantity_trays: number; price_per_tray_paisa: number }) =>
        sum + item.quantity_trays * item.price_per_tray_paisa,
      0
    ),
  }

  const [withPartnerName] = await enrichWithPartnerNames(supabase, [enriched])
  return NextResponse.json(withPartnerName)
}
