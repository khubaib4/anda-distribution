import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'
import {
  computeSaleSubtotalPaisa,
  computeSalePaymentBreakdown,
  effectiveItemPricePaisa,
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
    const discount = s.discount_amount_paisa ?? 0
    const total_paisa = subtotal - discount
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
    discount_amount_paisa,
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

  const { count, error: countError } = await supabase
    .from('sales')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', writeTenantId)

  if (countError) {
    return NextResponse.json(
      { error: countError.message },
      { status: 500 }
    )
  }

  const invoice_number = `SAL-${String((count ?? 0) + 1).padStart(4, '0')}`

  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .insert({
      tenant_id:             writeTenantId,
      customer_id,
      sale_date,
      invoice_number,
      notes:                 notes                 || null,
      payment_status:        payment_status        || 'unpaid',
      due_date:              due_date              || null,
      amount_paid_paisa:     amount_paid_paisa     ?? 0,
      discount_type:         discount_type         || null,
      discount_value:        discount_value        ?? 0,
      discount_amount_paisa: discount_amount_paisa ?? 0,
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

  const itemRows = items.map((item: {
    egg_category_id:        string
    quantity_trays:         number
    price_per_tray_paisa:   number
    discount_type?:         'percentage' | 'fixed' | null
    discount_value?:        number
    discounted_price_paisa?: number
  }) => ({
    tenant_id:              writeTenantId,
    sale_id:                sale.id,
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
    await supabase.from('sales').delete().eq('id', sale.id)
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

  const subtotalPaisa = items.reduce(
    (sum: number, item: {
      quantity_trays:         number
      price_per_tray_paisa:   number
      discounted_price_paisa?: number
    }) => sum + item.quantity_trays * effectiveItemPricePaisa(item),
    0,
  )
  const totalPaisa = subtotalPaisa - (discount_amount_paisa ?? 0)

  if (payment_status === 'paid') {
    const { error: paymentError } = await supabase
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
      await supabase.from('sales').delete().eq('id', sale.id)
      return NextResponse.json(
        { error: paymentError.message },
        { status: 500 }
      )
    }
  }

  if (
    payment_status === 'partial' &&
    amount_paid_paisa &&
    amount_paid_paisa > 0
  ) {
    const { error: paymentError } = await supabase
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
      await supabase.from('sales').delete().eq('id', sale.id)
      return NextResponse.json(
        { error: paymentError.message },
        { status: 500 }
      )
    }
  }

  return NextResponse.json(sale, { status: 201 })
}
