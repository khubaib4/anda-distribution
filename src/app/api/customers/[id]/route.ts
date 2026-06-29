import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq } from '@/lib/tenant-api'
import { computeSaleSubtotalPaisa } from '@/lib/utils'

function saleTotalPaisa(sale: {
  discount_amount_paisa?: number
  items?: Array<{
    quantity_trays: number
    price_per_tray_paisa: number
    discounted_price_paisa?: number
  }>
}): number {
  const subtotal = computeSaleSubtotalPaisa(sale.items ?? [])
  return subtotal - (sale.discount_amount_paisa ?? 0)
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

  const { data: customer, error: customerError } = await tenantEq(
    supabase.from('customers').select('*').eq('id', id),
    tenantId,
  ).single()

  if (customerError) {
    return NextResponse.json({ error: customerError.message }, { status: 500 })
  }
  if (!customer) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: salesData, error: salesError } = await tenantEq(
    supabase
      .from('sales')
      .select(`
        discount_amount_paisa,
        items:sale_items(
          quantity_trays,
          price_per_tray_paisa,
          discounted_price_paisa
        )
      `)
      .eq('customer_id', id),
    tenantId,
  )

  if (salesError) {
    return NextResponse.json({ error: salesError.message }, { status: 500 })
  }

  const { data: paymentsData, error: paymentsError } = await tenantEq(
    supabase
      .from('customer_payments')
      .select('amount_paisa')
      .eq('customer_id', id),
    tenantId,
  )

  if (paymentsError) {
    return NextResponse.json({ error: paymentsError.message }, { status: 500 })
  }

  const total_sales_paisa = (salesData ?? []).reduce(
    (sum, sale) => sum + saleTotalPaisa(sale),
    0,
  )
  const total_paid_paisa = (paymentsData ?? []).reduce(
    (sum, p) => sum + p.amount_paisa,
    0,
  )

  return NextResponse.json({
    customer_id:       customer.id,
    contact_name:      customer.contact_name,
    business_name:     customer.business_name,
    phone:             customer.phone,
    customer_type:     customer.customer_type,
    is_active:         customer.is_active,
    total_sales_paisa,
    total_paid_paisa,
    balance_paisa:     total_sales_paisa - total_paid_paisa,
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const { id } = await params
  const supabase = await createClient()
  const body     = await request.json()

  const {
    contact_name,
    business_name,
    phone,
    address,
    customer_type,
    notes,
    is_active,
  } = body

  if (contact_name !== undefined && !contact_name?.trim()) {
    return NextResponse.json(
      { error: 'Contact name is required' },
      { status: 400 }
    )
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (contact_name  !== undefined) updates.contact_name  = contact_name.trim()
  if (business_name !== undefined) updates.business_name = business_name?.trim() || null
  if (phone         !== undefined) updates.phone         = phone?.trim()         || null
  if (address       !== undefined) updates.address       = address?.trim()       || null
  if (customer_type !== undefined) updates.customer_type = customer_type         || null
  if (notes         !== undefined) updates.notes         = notes?.trim()         || null
  if (is_active     !== undefined) updates.is_active     = is_active

  const { data, error } = await tenantEq(
    supabase.from('customers').update(updates).eq('id', id),
    tenantId,
  )
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
