import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, requireWriteTenantId } from '@/lib/tenant-api'
import { enrichWithPartnerNames } from '@/lib/expense-partners'
import { createAdminClient } from '@/lib/supabase/admin'

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

  if (items !== undefined) {
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'At least one item is required' },
        { status: 400 },
      )
    }
    for (const item of items) {
      if (!item.egg_category_id || !item.quantity_trays || !item.price_per_tray_paisa) {
        return NextResponse.json(
          { error: 'Each item needs category, quantity, and price' },
          { status: 400 },
        )
      }
    }
  }

  const { data: existing, error: fetchError } = await supabase
    .from('purchases')
    .select(`
      id,
      invoice_number,
      purchase_date,
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

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (supplier_id       !== undefined) updates.supplier_id            = supplier_id || null
  if (supplier_name     !== undefined) updates.supplier_name_snapshot = supplier_name || null
  if (purchase_date     !== undefined) updates.purchase_date          = purchase_date
  if (notes             !== undefined) updates.notes                  = notes || null
  if (payment_status    !== undefined) updates.payment_status         = payment_status
  if (amount_paid_paisa !== undefined) updates.amount_paid_paisa     = amount_paid_paisa

  if (paid_by !== undefined) {
    const paidBy = paid_by === 'partner' ? 'partner' : 'business'
    if (paidBy === 'partner' && !paid_by_partner_id) {
      return NextResponse.json(
        { error: 'Partner is required when paid by partner' },
        { status: 400 },
      )
    }
    updates.paid_by                = paidBy
    updates.paid_by_partner_id     = paidBy === 'partner' ? paid_by_partner_id : null
    updates.paid_by_partner_source = paidBy === 'partner' ? paid_by_partner_source : null
  }

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

  const admin = createAdminClient()
  const capitalNotes = `Paid purchase: ${invoiceNumber}`
  const finalPaidBy = data.paid_by ?? 'business'

  if (finalPaidBy !== 'partner') {
    await admin
      .from('capital_transactions')
      .delete()
      .eq('tenant_id', writeTenantId)
      .eq('notes', capitalNotes)
  } else if (data.paid_by_partner_id) {
    const partnerSource = data.paid_by_partner_source
    const capitalFields: Record<string, unknown> = {
      amount_paisa:     enriched.total_paisa,
      transaction_date: data.purchase_date,
      updated_at:       new Date().toISOString(),
    }

    if (partnerSource === 'partner') {
      capitalFields.partner_id         = null
      capitalFields.partner_profile_id = data.paid_by_partner_id
    } else {
      capitalFields.partner_id         = data.paid_by_partner_id
      capitalFields.partner_profile_id = null
    }

    const { data: existingCapital } = await admin
      .from('capital_transactions')
      .select('id')
      .eq('tenant_id', writeTenantId)
      .eq('notes', capitalNotes)
      .maybeSingle()

    if (existingCapital) {
      const { error: capitalError } = await admin
        .from('capital_transactions')
        .update(capitalFields)
        .eq('id', existingCapital.id)

      if (capitalError) {
        return NextResponse.json(
          { error: `Purchase saved but capital update failed: ${capitalError.message}` },
          { status: 500 },
        )
      }
    } else {
      const { error: capitalError } = await admin
        .from('capital_transactions')
        .insert({
          tenant_id:  writeTenantId,
          type:       'contribution',
          notes:      capitalNotes,
          reference:  null,
          created_by: user?.id || null,
          ...capitalFields,
        })

      if (capitalError) {
        return NextResponse.json(
          { error: `Purchase saved but capital entry failed: ${capitalError.message}` },
          { status: 500 },
        )
      }
    }
  }

  const [withPartnerName] = await enrichWithPartnerNames(supabase, [enriched])
  return NextResponse.json(withPartnerName)
}
