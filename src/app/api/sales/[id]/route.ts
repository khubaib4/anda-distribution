import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'
import {
  computeSaleSubtotalPaisa,
  computeSalePaymentBreakdown,
  effectiveItemPricePaisa,
  todayString,
} from '@/lib/utils'

function enrichSale(data: {
  payment_status: string
  amount_paid_paisa?: number
  items?: Array<{
    quantity_trays: number
    price_per_tray_paisa: number
    discounted_price_paisa?: number
    cost_per_tray_paisa: number
  }>
  discount_amount_paisa?: number
}) {
  const subtotal = computeSaleSubtotalPaisa(data.items ?? [])
  const discount = data.discount_amount_paisa ?? 0
  const total_paisa = subtotal - discount
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
    revenue_paisa: (data.items ?? []).reduce(
      (sum, item) =>
        sum + item.quantity_trays * effectiveItemPricePaisa(item),
      0,
    ),
  }
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
      .eq('id', id),
    tenantId,
  ).single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(enrichSale(data))
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

  const { payment_status, notes, payment_method, bank_account_id } = body

  const { data: existing, error: fetchError } = await tenantEq(
    supabase
      .from('sales')
      .select('id, payment_status, customer_id, invoice_number, discount_amount_paisa')
      .eq('id', id),
    tenantId,
  ).single()

  if (fetchError || !existing) {
    return NextResponse.json(
      { error: fetchError?.message ?? 'Not found' },
      { status: fetchError ? 500 : 404 },
    )
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (payment_status !== undefined) updates.payment_status = payment_status
  if (notes          !== undefined) updates.notes          = notes

  const { data, error } = await tenantEq(
    supabase.from('sales').update(updates).eq('id', id),
    tenantId,
  )
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const becamePaid =
    payment_status === 'paid' &&
    existing.payment_status !== 'paid'

  if (becamePaid && existing.invoice_number) {
    const paymentNotes = `Payment for ${existing.invoice_number}`

    const { data: existingPayment } = await supabase
      .from('customer_payments')
      .select('id')
      .eq('notes', paymentNotes)
      .maybeSingle()

    if (!existingPayment) {
      const { data: saleItems } = await supabase
        .from('sale_items')
        .select('quantity_trays, price_per_tray_paisa, discounted_price_paisa')
        .eq('sale_id', id)

      const subtotal = computeSaleSubtotalPaisa(saleItems ?? [])
      const amountPaisa = subtotal - (existing.discount_amount_paisa ?? 0)

      if (amountPaisa > 0) {
        const { error: paymentError } = await supabase
          .from('customer_payments')
          .insert({
            tenant_id:       writeTenantId,
            customer_id:     existing.customer_id,
            amount_paisa:    amountPaisa,
            payment_date:    todayString(),
            payment_method:  payment_method  || null,
            bank_account_id: bank_account_id || null,
            notes:           paymentNotes,
            created_by:      user?.id        || null,
          })

        if (paymentError) {
          return NextResponse.json(
            { error: paymentError.message },
            { status: 500 },
          )
        }
      }
    }
  }

  return NextResponse.json(data)
}
