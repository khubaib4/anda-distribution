import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createTrustedHeaderWriter } from '@/lib/supabase/trusted-header-writer'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'
import { recalculateCustomerSaleAllocations } from '@/lib/customer-payment-allocation'
import { validateSaleStockAvailability } from '@/lib/stock-availability'
import {
  computeSaleSubtotalPaisa,
  computeSaleTotalPaisa,
  computeSalePaymentBreakdown,
  validateSaleItems,
  validateSaleDiscount,
} from '@/lib/utils'

export async function GET(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)

  const status     = searchParams.get('status')
  const customerId = searchParams.get('customer_id')
  const from       = searchParams.get('from')
  const to         = searchParams.get('to')

  let query = tenantEq(
    supabase
      .from('sales')
      .select(`
        *,
        customer:customers(id, contact_name, business_name, phone),
        items:sale_items(
          id,
          quantity_trays,
          price_per_tray_paisa,
          discount_type,
          discount_value,
          discounted_price_paisa,
          cost_per_tray_paisa,
          egg_category:egg_categories(id, name)
        )
      `)
      .order('sale_date',   { ascending: false })
      .order('created_at',  { ascending: false }),
    tenantId,
  )

  if (status)     query = query.eq('payment_status', status)
  if (customerId) query = query.eq('customer_id', customerId)
  if (from)       query = query.gte('sale_date', from)
  if (to)         query = query.lte('sale_date', to)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const enriched = (data ?? []).map(s => {
    const subtotal = computeSaleSubtotalPaisa(s.items ?? [])
    const total_paisa = computeSaleTotalPaisa(s)
    const { paid_paisa, remaining_paisa } = computeSalePaymentBreakdown({
      payment_status:    s.payment_status,
      amount_paid_paisa: s.amount_paid_paisa,
      total_paisa,
    })
    return {
      ...s,
      subtotal_paisa: subtotal,
      total_paisa,
      paid_paisa,
      remaining_paisa,
    }
  })

  return NextResponse.json(enriched)
}

export async function POST(request: Request) {
  const auth = await authorizeApi(request, { permission: 'sales' })
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
    customer_id,
    sale_date,
    payment_status,
    payment_method,
    bank_account_id,
    due_date,
    amount_paid_paisa,
    notes,
    discount_type,
    discount_value,
    items,
  } = body

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
  const validatedItems = validateSaleItems(items)
  if (!validatedItems.ok) {
    return NextResponse.json({ error: validatedItems.error }, { status: 400 })
  }
  const saleItems = validatedItems.items
  const subtotalPaisa = computeSaleSubtotalPaisa(saleItems)
  const saleDiscount = validateSaleDiscount(subtotalPaisa, discount_type, discount_value)
  if (!saleDiscount.ok) {
    return NextResponse.json({ error: saleDiscount.error }, { status: 400 })
  }
  const totalPaisa = subtotalPaisa - saleDiscount.discount_amount_paisa

  if (totalPaisa === 0 && payment_status === 'partial') {
    return NextResponse.json(
      { error: 'A zero-total sale cannot have a partial payment' },
      { status: 400 },
    )
  }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id')
    .eq('id', customer_id)
    .eq('tenant_id', writeTenantId)
    .maybeSingle()

  if (customerError) {
    return NextResponse.json({ error: customerError.message }, { status: 500 })
  }
  if (!customer) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 400 })
  }

  const willCreatePayment = totalPaisa > 0 && (
    payment_status === 'paid' || (
      payment_status === 'partial' &&
      amount_paid_paisa &&
      amount_paid_paisa > 0
    )
  )

  if (willCreatePayment && bank_account_id != null && bank_account_id !== '') {
    if (typeof bank_account_id !== 'string' || !bank_account_id.trim()) {
      return NextResponse.json({ error: 'Bank account not found' }, { status: 400 })
    }

    const { data: bankAccount, error: bankAccountError } = await supabase
      .from('bank_accounts')
      .select('id')
      .eq('id', bank_account_id)
      .eq('tenant_id', writeTenantId)
      .maybeSingle()

    if (bankAccountError) {
      if (bankAccountError.code === '22P02') {
        return NextResponse.json({ error: 'Bank account not found' }, { status: 400 })
      }
      return NextResponse.json({ error: bankAccountError.message }, { status: 500 })
    }
    if (!bankAccount) {
      return NextResponse.json({ error: 'Bank account not found' }, { status: 400 })
    }
  }

  const stockAvailability = await validateSaleStockAvailability({
    supabase,
    tenantId: writeTenantId,
    items: saleItems,
  })

  if (stockAvailability.invalidItems.length > 0) {
    return NextResponse.json(
      {
        error: 'Invalid sale stock request',
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

  const categoryIds = [...new Set(saleItems.map((i: { egg_category_id: string }) =>
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

  const invoiceClient = auth.ctx.isSuperAdmin ? createAdminClient() : supabase
  const invoiceAllocator = auth.ctx.isSuperAdmin
    ? 'allocate_invoice_number_trusted_v1'
    : 'allocate_invoice_number_v1'
  const { data: invoice_number, error: invoiceError } = await invoiceClient.rpc(
    invoiceAllocator,
    { p_tenant_id: writeTenantId, p_counter_type: 'sale' },
  )

  if (invoiceError || !invoice_number) {
    return NextResponse.json(
      { error: invoiceError?.message ?? 'Invoice allocation failed' },
      { status: invoiceError?.code === '42501' ? 403 : 500 },
    )
  }

  const admin = createAdminClient()
  const { data: sale, error: saleError } = await admin
    .from('sales')
    .insert({
      tenant_id:             writeTenantId,
      customer_id,
      sale_date,
      invoice_number,
      notes:                 notes                 || null,
      payment_status:        payment_status        || 'unpaid',
      due_date:              due_date              || null,
      amount_paid_paisa:     totalPaisa === 0 ? 0 : (amount_paid_paisa ?? 0),
      discount_type:         saleDiscount.discount_type,
      discount_value:        saleDiscount.discount_value,
      discount_amount_paisa: saleDiscount.discount_amount_paisa,
      created_by:            user?.id              || null,
    })
    .select()
    .single()

  if (saleError) {
    return NextResponse.json(
      { error: saleError.message },
      { status: 500 }
    )
  }

  const itemRows = saleItems.map(item => ({
    tenant_id:              writeTenantId,
    sale_id:                sale.id,
    egg_category_id:        item.egg_category_id,
    quantity_trays:         item.quantity_trays,
    price_per_tray_paisa:   item.price_per_tray_paisa,
    discount_type:          item.discount_type,
    discount_value:         item.discount_value,
    discounted_price_paisa: item.discounted_price_paisa,
    cost_per_tray_paisa:    avgCosts[item.egg_category_id] ?? 0,
  }))

  const { error: itemsError } = await supabase
    .from('sale_items')
    .insert(itemRows)

  if (itemsError) {
    await admin.from('sales').delete().eq('id', sale.id).eq('tenant_id', writeTenantId)
    return NextResponse.json(
      { error: itemsError.message },
      { status: 500 }
    )
  }

  const movementRows = saleItems.map(item => ({
    tenant_id:       writeTenantId,
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
    await admin.from('sales').delete().eq('id', sale.id).eq('tenant_id', writeTenantId)
    return NextResponse.json(
      { error: movementsError.message },
      { status: 500 }
    )
  }

  if (payment_status === 'paid' && totalPaisa > 0) {
    const { error: paymentError } = await admin
      .from('customer_payments')
      .insert({
        tenant_id:       writeTenantId,
        customer_id,
        amount_paisa:    totalPaisa,
        payment_date:    sale_date,
        payment_method:  payment_method  || null,
        bank_account_id: bank_account_id || null,
        notes:           `Payment for ${invoice_number}`,
        created_by:      user?.id        || null,
      })

    if (paymentError) {
      await admin.from('sales').delete().eq('id', sale.id).eq('tenant_id', writeTenantId)
      return NextResponse.json(
        { error: paymentError.message },
        { status: 500 }
      )
    }
  }

  if (
    payment_status === 'partial' &&
    amount_paid_paisa &&
    amount_paid_paisa > 0 &&
    totalPaisa > 0
  ) {
    const { error: paymentError } = await admin
      .from('customer_payments')
      .insert({
        tenant_id:       writeTenantId,
        customer_id,
        amount_paisa:    amount_paid_paisa,
        payment_date:    sale_date,
        payment_method:  payment_method  || null,
        bank_account_id: bank_account_id || null,
        notes:           `Partial payment for ${invoice_number}`,
        created_by:      user?.id        || null,
      })

    if (paymentError) {
      await admin.from('sales').delete().eq('id', sale.id).eq('tenant_id', writeTenantId)
      return NextResponse.json(
        { error: paymentError.message },
        { status: 500 }
      )
    }
  }

  try {
    const allocation = await recalculateCustomerSaleAllocations({
      supabase,
      trustedWriter: createTrustedHeaderWriter(),
      tenantId: writeTenantId,
      customerId: customer_id,
    })

    const { data: refreshedSale, error: refreshError } = await supabase
      .from('sales')
      .select('*')
      .eq('id', sale.id)
      .eq('tenant_id', writeTenantId)
      .single()

    if (refreshError) {
      console.error('Sale FIFO allocation succeeded but sale refresh failed', {
        tenantId: writeTenantId,
        customerId: customer_id,
        saleId: sale.id,
        invoiceNumber: invoice_number,
        error: refreshError,
      })

      return NextResponse.json(
        {
          ...sale,
          allocation,
          allocation_warning:
            'Sale was saved and customer payment allocation was refreshed, but updated sale data could not be reloaded automatically.',
        },
        { status: 201 },
      )
    }

    return NextResponse.json({ ...refreshedSale, allocation }, { status: 201 })
  } catch (allocationError) {
    console.error('Sale saved but FIFO allocation failed', {
      tenantId: writeTenantId,
      customerId: customer_id,
      saleId: sale.id,
      invoiceNumber: invoice_number,
      error: allocationError,
    })

    return NextResponse.json(
      {
        ...sale,
        allocation_warning:
          'Sale was saved, but customer payment allocation could not be refreshed automatically.',
      },
      { status: 201 },
    )
  }
}
