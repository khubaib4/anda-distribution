import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'
import { enrichWithPartnerNames } from '@/lib/expense-partners'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  computeSaleSubtotalPaisa,
  computeSaleTotalPaisa,
  computeSalePaymentBreakdown,
} from '@/lib/utils'

const SALE_SELECT = `
  *,
  customer:customers(id, contact_name, business_name, phone),
  items:sale_items(
    id,
    egg_category_id,
    quantity_trays,
    price_per_tray_paisa,
    discount_type,
    discount_value,
    discounted_price_paisa,
    cost_per_tray_paisa,
    egg_category:egg_categories(id, name)
  )
`

function enrichSale<T extends {
  payment_status: string
  amount_paid_paisa?: number
  items?: Array<{
    quantity_trays: number
    price_per_tray_paisa: number
    discounted_price_paisa?: number
    cost_per_tray_paisa: number
  }>
  discount_amount_paisa?: number
}>(data: T) {
  const subtotal = computeSaleSubtotalPaisa(data.items ?? [])
  const total_paisa = computeSaleTotalPaisa(data)
  const { paid_paisa, remaining_paisa } = computeSalePaymentBreakdown({
    payment_status:    data.payment_status,
    amount_paid_paisa: data.amount_paid_paisa,
    total_paisa,
  })
  return {
    ...data,
    subtotal_paisa: subtotal,
    total_paisa,
    paid_paisa,
    remaining_paisa,
    cogs_paisa: (data.items ?? []).reduce(
      (sum, item) => sum + item.quantity_trays * item.cost_per_tray_paisa,
      0,
    ),
    revenue_paisa: computeSaleTotalPaisa(data),
  }
}

async function syncCustomerPayments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  opts: {
    writeTenantId: string
    customerId: string
    invoiceNumber: string
    saleDate: string
    paymentStatus: string
    totalPaisa: number
    amountPaidPaisa: number
    paymentMethod?: string | null
    bankAccountId?: string | null
    userId?: string | null
  },
) {
  const {
    writeTenantId,
    customerId,
    invoiceNumber,
    saleDate,
    paymentStatus,
    totalPaisa,
    amountPaidPaisa,
    paymentMethod,
    bankAccountId,
    userId,
  } = opts

  const paidNotes = `Payment for ${invoiceNumber}`
  const partialNotes = `Partial payment for ${invoiceNumber}`

  await supabase
    .from('customer_payments')
    .delete()
    .eq('tenant_id', writeTenantId)
    .in('notes', [paidNotes, partialNotes])

  if (paymentStatus === 'paid' && totalPaisa > 0) {
    const { error } = await supabase.from('customer_payments').insert({
      tenant_id:       writeTenantId,
      customer_id:     customerId,
      amount_paisa:    totalPaisa,
      payment_date:    saleDate,
      payment_method:  paymentMethod  || null,
      bank_account_id: bankAccountId || null,
      notes:           paidNotes,
      created_by:      userId        || null,
    })
    if (error) return error
  } else if (
    paymentStatus === 'partial' &&
    amountPaidPaisa > 0
  ) {
    const { error } = await supabase.from('customer_payments').insert({
      tenant_id:       writeTenantId,
      customer_id:     customerId,
      amount_paisa:    amountPaidPaisa,
      payment_date:    saleDate,
      payment_method:  paymentMethod  || null,
      bank_account_id: bankAccountId || null,
      notes:           partialNotes,
      created_by:      userId        || null,
    })
    if (error) return error
  }

  return null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await tenantEq(
    supabase
      .from('sales')
      .select(SALE_SELECT)
      .eq('id', id),
    tenantId,
  ).single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const enriched = enrichSale(data)
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
    customer_id,
    sale_date,
    notes,
    payment_status,
    payment_method,
    bank_account_id,
    due_date,
    amount_paid_paisa,
    discount_type,
    discount_value,
    discount_amount_paisa,
    paid_by,
    paid_by_partner_id,
    paid_by_partner_source,
    items,
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

  const { data: existing, error: fetchError } = await tenantEq(
    supabase
      .from('sales')
      .select(`
        id,
        invoice_number,
        sale_date,
        customer_id,
        payment_status,
        discount_amount_paisa,
        paid_by,
        paid_by_partner_id,
        paid_by_partner_source
      `)
      .eq('id', id),
    tenantId,
  ).single()

  if (fetchError || !existing) {
    return NextResponse.json(
      { error: fetchError?.message ?? 'Not found' },
      { status: fetchError ? 500 : 404 },
    )
  }

  const invoiceNumber = existing.invoice_number

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (customer_id           !== undefined) updates.customer_id           = customer_id
  if (sale_date             !== undefined) updates.sale_date             = sale_date
  if (notes                 !== undefined) updates.notes                 = notes || null
  if (payment_status        !== undefined) updates.payment_status        = payment_status
  if (due_date              !== undefined) updates.due_date              = due_date || null
  if (amount_paid_paisa     !== undefined) updates.amount_paid_paisa     = amount_paid_paisa ?? 0
  if (discount_type         !== undefined) updates.discount_type         = discount_type || null
  if (discount_value        !== undefined) updates.discount_value        = discount_value ?? 0
  if (discount_amount_paisa !== undefined) updates.discount_amount_paisa = discount_amount_paisa ?? 0

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
    .from('sales')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', writeTenantId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  const movementDate = sale_date ?? existing.sale_date

  if (items !== undefined) {
    const categoryIds = [...new Set(items.map((i: { egg_category_id: string }) =>
      i.egg_category_id
    ))]

    const { data: costData } = await tenantEq(
      supabase
        .from('purchase_items')
        .select('egg_category_id, price_per_tray_paisa')
        .in('egg_category_id', categoryIds),
      tenantId,
    )

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

    const { error: delItemsError } = await supabase
      .from('sale_items')
      .delete()
      .eq('sale_id', id)
      .eq('tenant_id', writeTenantId)

    if (delItemsError) {
      return NextResponse.json({ error: delItemsError.message }, { status: 500 })
    }

    const { error: delMovError } = await supabase
      .from('stock_movements')
      .delete()
      .eq('reference_id', id)
      .eq('movement_type', 'sale_out')
      .eq('tenant_id', writeTenantId)

    if (delMovError) {
      return NextResponse.json({ error: delMovError.message }, { status: 500 })
    }

    const itemRows = items.map((item: {
      egg_category_id:        string
      quantity_trays:         number
      price_per_tray_paisa:   number
      discount_type?:         'percentage' | 'fixed' | null
      discount_value?:        number
      discounted_price_paisa?: number
    }) => ({
      tenant_id:              writeTenantId,
      sale_id:                id,
      egg_category_id:        item.egg_category_id,
      quantity_trays:         item.quantity_trays,
      price_per_tray_paisa:   item.price_per_tray_paisa,
      discount_type:          item.discount_type          ?? null,
      discount_value:         item.discount_value         ?? 0,
      discounted_price_paisa: item.discounted_price_paisa ?? 0,
      cost_per_tray_paisa:    avgCosts[item.egg_category_id] ?? 0,
    }))

    const { error: itemsError } = await supabase
      .from('sale_items')
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
      movement_type:   'sale_out',
      quantity_trays:  item.quantity_trays,
      reference_id:    id,
      notes:           `Sale ${invoiceNumber}`,
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
    .from('sales')
    .select(SALE_SELECT)
    .eq('id', id)
    .eq('tenant_id', writeTenantId)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const enriched = enrichSale(data)
  const finalPaymentStatus = data.payment_status
  const finalCustomerId = data.customer_id
  const finalSaleDate = data.sale_date

  if (items !== undefined || payment_status !== undefined) {
    const paymentError = await syncCustomerPayments(supabase, {
      writeTenantId,
      customerId:     finalCustomerId,
      invoiceNumber:  invoiceNumber!,
      saleDate:       finalSaleDate,
      paymentStatus:  finalPaymentStatus,
      totalPaisa:     enriched.total_paisa,
      amountPaidPaisa: data.amount_paid_paisa ?? 0,
      paymentMethod:  payment_method,
      bankAccountId: bank_account_id,
      userId:         user?.id,
    })

    if (paymentError) {
      return NextResponse.json(
        { error: `Sale saved but payment sync failed: ${paymentError.message}` },
        { status: 500 },
      )
    }
  } else if (
    payment_status === 'paid' &&
    existing.payment_status !== 'paid' &&
    invoiceNumber
  ) {
    const paymentError = await syncCustomerPayments(supabase, {
      writeTenantId,
      customerId:     finalCustomerId,
      invoiceNumber,
      saleDate:       finalSaleDate,
      paymentStatus:  'paid',
      totalPaisa:     enriched.total_paisa,
      amountPaidPaisa: data.amount_paid_paisa ?? 0,
      paymentMethod:  payment_method,
      bankAccountId: bank_account_id,
      userId:         user?.id,
    })

    if (paymentError) {
      return NextResponse.json({ error: paymentError.message }, { status: 500 })
    }
  }

  const admin = createAdminClient()
  const capitalNotes = `Paid sale: ${invoiceNumber}`
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
      transaction_date: finalSaleDate,
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
          { error: `Sale saved but capital update failed: ${capitalError.message}` },
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
          { error: `Sale saved but capital entry failed: ${capitalError.message}` },
          { status: 500 },
        )
      }
    }
  }

  const [withPartnerName] = await enrichWithPartnerNames(supabase, [enriched])
  return NextResponse.json(withPartnerName)
}
