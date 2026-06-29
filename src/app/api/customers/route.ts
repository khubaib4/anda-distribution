import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'
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

export async function GET(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const type     = searchParams.get('type')
  const inactive = searchParams.get('inactive') === 'true'

  let customerQuery = tenantEq(
    supabase.from('customers').select('*'),
    tenantId,
  ).order('contact_name')

  if (!inactive) customerQuery = customerQuery.eq('is_active', true)
  if (type)      customerQuery = customerQuery.eq('customer_type', type)

  const { data: customers, error: customersError } = await customerQuery

  if (customersError) {
    return NextResponse.json({ error: customersError.message }, { status: 500 })
  }

  const { data: salesData, error: salesError } = await tenantEq(
    supabase
      .from('sales')
      .select(`
        customer_id,
        discount_amount_paisa,
        items:sale_items(
          quantity_trays,
          price_per_tray_paisa,
          discounted_price_paisa
        )
      `),
    tenantId,
  )

  if (salesError) {
    return NextResponse.json({ error: salesError.message }, { status: 500 })
  }

  const { data: paymentsData, error: paymentsError } = await tenantEq(
    supabase.from('customer_payments').select('customer_id, amount_paisa'),
    tenantId,
  )

  if (paymentsError) {
    return NextResponse.json({ error: paymentsError.message }, { status: 500 })
  }

  const salesByCustomer: Record<string, number> = {}
  for (const sale of salesData ?? []) {
    const total = saleTotalPaisa(sale)
    salesByCustomer[sale.customer_id] =
      (salesByCustomer[sale.customer_id] ?? 0) + total
  }

  const paymentsByCustomer: Record<string, number> = {}
  for (const payment of paymentsData ?? []) {
    paymentsByCustomer[payment.customer_id] =
      (paymentsByCustomer[payment.customer_id] ?? 0) + payment.amount_paisa
  }

  const data = (customers ?? []).map(c => {
    const total_sales_paisa = salesByCustomer[c.id] ?? 0
    const total_paid_paisa  = paymentsByCustomer[c.id] ?? 0
    return {
      customer_id:       c.id,
      contact_name:      c.contact_name,
      business_name:     c.business_name,
      phone:             c.phone,
      customer_type:     c.customer_type,
      is_active:         c.is_active,
      total_sales_paisa,
      total_paid_paisa,
      balance_paisa:     total_sales_paisa - total_paid_paisa,
    }
  })

  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const writeTenantId = requireWriteTenantId(tenantId, request)
  if (writeTenantId instanceof NextResponse) return writeTenantId

  const supabase = await createClient()
  const body     = await request.json()

  const {
    contact_name,
    business_name,
    phone,
    address,
    customer_type,
    notes,
  } = body

  if (!contact_name?.trim()) {
    return NextResponse.json(
      { error: 'Contact name is required' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('customers')
    .insert({
      tenant_id:     writeTenantId,
      contact_name:  contact_name.trim(),
      business_name: business_name?.trim() || null,
      phone:         phone?.trim()         || null,
      address:       address?.trim()       || null,
      customer_type: customer_type         || null,
      notes:         notes?.trim()         || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
