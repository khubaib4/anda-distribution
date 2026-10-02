import { computePurchaseTotalPaisa, validatePurchaseItems } from '@/lib/utils'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createTrustedHeaderWriter } from '@/lib/supabase/trusted-header-writer'
import { NextResponse } from 'next/server'
import { authorizeApi, requireWriteTenantId } from '@/lib/tenant-api'
import { enrichWithPartnerNames } from '@/lib/expense-partners'
import { validatePurchaseEditStockAvailability } from '@/lib/stock-availability'
import { recalculateSupplierPurchaseAllocations } from '@/lib/supplier-payment-allocation'

const PURCHASE_SELECT = `
  *,
  supplier:suppliers(id, name, phone),
  items:purchase_items(
    id,
    egg_category_id,
    quantity_trays,
    price_per_tray_paisa,
    price_per_peti_paisa,
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
    total_paisa: computePurchaseTotalPaisa(data.items ?? []),
  }

  const [withPartnerName] = await enrichWithPartnerNames(supabase, [enriched])
  return NextResponse.json(withPartnerName)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeApi(request, { permission: 'purchases' })
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const writeTenantId = requireWriteTenantId(tenantId, request)
  if (writeTenantId instanceof NextResponse) return writeTenantId

  const { id } = await params
  const supabase = await createClient()

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
      paid_by_partner_source,
      updated_at
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

  const oldSupplierId = existing.supplier_id
  const finalSupplierId = supplier_id !== undefined ? supplier_id || null : oldSupplierId
  const shouldRecalculateAllocation =
    items !== undefined ||
    (purchase_date !== undefined && purchase_date !== existing.purchase_date) ||
    finalSupplierId !== oldSupplierId

  if (items !== undefined) {
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'At least one item is required' },
        { status: 400 },
      )
    }

    const validatedItems = validatePurchaseItems(items)
    if (!validatedItems.ok) return NextResponse.json({ error: validatedItems.error }, { status: 400 })

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

  // Send only editable values. Actor, business and edit version come from the
  // signed-in session/read above, never from request JSON. The database saves
  // the header, items and stock together, or rolls the entire edit back.
  const payload: Record<string, unknown> = {}
  if (supplier_id !== undefined) payload.supplier_id = supplier_id || null
  if (supplier_name !== undefined) payload.supplier_name = supplier_name || null
  if (purchase_date !== undefined) payload.purchase_date = purchase_date
  if (notes !== undefined) payload.notes = notes || null
  if (items !== undefined) payload.items = items

  let editError
  try {
    const result = await createAdminClient().rpc('edit_purchase_stock_v1', {
      p_actor: auth.ctx.userId,
      p_tenant: writeTenantId,
      p_purchase: id,
      p_expected_updated_at: existing.updated_at,
      p_payload: payload,
    })
    editError = result.error
  } catch {
    return NextResponse.json({ error: 'Unable to confirm this purchase edit. Reload the purchase before trying again.' }, { status: 503 })
  }
  if (editError) {
    const code = editError.code ?? ''
    if (['40P01', '40001', '55P03'].includes(code)) {
      return NextResponse.json({ error: 'Stock changed while saving. Reload the purchase and try again.' }, { status: 409 })
    }
    const status = code === '42501' ? 403 : code === 'P0002' ? 404
      : ['23514', 'P0001'].includes(code) ? 409
      : ['22023', '22P02', '22003', '22007', '22008', '23502', '23503'].includes(code) ? 400 : 503
    return NextResponse.json({ error: status === 503
      ? 'Unable to confirm this purchase edit. Reload the purchase before trying again.'
      : editError.message }, { status })
  }

  const invoiceNumber = existing.invoice_number

  let allocationWarning: string | undefined
  if (shouldRecalculateAllocation) {
    const supplierIds = Array.from(
      new Set(
        [oldSupplierId, finalSupplierId].filter(
          (supplierId): supplierId is string => Boolean(supplierId),
        ),
      ),
    )

    for (const allocationSupplierId of supplierIds) {
      try {
        await recalculateSupplierPurchaseAllocations({
          supabase,
          trustedWriter: createTrustedHeaderWriter(),
          tenantId: writeTenantId,
          supplierId: allocationSupplierId,
        })
      } catch (allocationError) {
        console.error('Purchase saved but supplier FIFO allocation failed', {
          tenantId: writeTenantId,
          oldSupplierId,
          newSupplierId: finalSupplierId,
          supplierId: allocationSupplierId,
          purchaseId: id,
          invoiceNumber,
          error: allocationError,
        })
        allocationWarning =
          'Purchase was saved, but supplier payment allocation could not be refreshed automatically. Do not repeat this edit.'
      }
    }
  }

  let finalData
  try {
    const { data, error } = await supabase
      .from('purchases')
      .select(PURCHASE_SELECT)
      .eq('id', id)
      .eq('tenant_id', writeTenantId)
      .single()

    if (error || !data) {
      throw error ?? new Error('Purchase not found after saving')
    }
    finalData = data
  } catch (refreshError) {
    console.error('Purchase saved but refreshed purchase could not be loaded', {
      tenantId: writeTenantId,
      oldSupplierId,
      newSupplierId: finalSupplierId,
      purchaseId: id,
      invoiceNumber,
      error: refreshError,
    })
    return NextResponse.json({
      id,
      invoice_number: invoiceNumber,
      allocation_warning: allocationWarning
        ? `${allocationWarning} Updated purchase data could not be reloaded automatically.`
        : 'Purchase was saved, but updated purchase data could not be reloaded automatically. Do not repeat this edit.',
    })
  }

  const enriched = {
    ...finalData,
    total_paisa: computePurchaseTotalPaisa(finalData.items ?? []),
  }

  const [withPartnerName] = await enrichWithPartnerNames(supabase, [enriched])
  return NextResponse.json(
    allocationWarning
      ? { ...withPartnerName, allocation_warning: allocationWarning }
      : withPartnerName,
  )
}
