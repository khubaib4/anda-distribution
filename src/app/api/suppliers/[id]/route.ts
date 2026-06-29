import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi } from '@/lib/tenant-api'

function purchaseTotalPaisa(items: { quantity_trays: number; price_per_tray_paisa: number }[]) {
  return (items ?? []).reduce(
    (sum, item) => sum + item.quantity_trays * item.price_per_tray_paisa,
    0,
  )
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

  let supplierQuery = supabase
    .from('suppliers')
    .select('id, name, phone, is_active')
    .eq('id', id)
  if (tenantId) supplierQuery = supplierQuery.eq('tenant_id', tenantId)

  const { data: supplier, error: supplierError } = await supplierQuery.single()

  if (supplierError) {
    return NextResponse.json({ error: supplierError.message }, { status: 500 })
  }
  if (!supplier) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let purchasesQuery = supabase
    .from('purchases')
    .select(`
      items:purchase_items(quantity_trays, price_per_tray_paisa)
    `)
    .eq('supplier_id', id)
  if (tenantId) purchasesQuery = purchasesQuery.eq('tenant_id', tenantId)

  const { data: purchases, error: purchasesError } = await purchasesQuery

  if (purchasesError) {
    return NextResponse.json({ error: purchasesError.message }, { status: 500 })
  }

  let paymentsQuery = supabase
    .from('supplier_payments')
    .select('amount_paisa')
    .eq('supplier_id', id)
  if (tenantId) paymentsQuery = paymentsQuery.eq('tenant_id', tenantId)

  const { data: payments, error: paymentsError } = await paymentsQuery

  if (paymentsError) {
    return NextResponse.json({ error: paymentsError.message }, { status: 500 })
  }

  const total_purchases_paisa = (purchases ?? []).reduce(
    (sum, p) => sum + purchaseTotalPaisa(p.items ?? []),
    0,
  )
  const total_paid_paisa = (payments ?? []).reduce(
    (sum, p) => sum + p.amount_paisa,
    0,
  )

  return NextResponse.json({
    supplier_id: supplier.id,
    name:        supplier.name,
    phone:       supplier.phone,
    is_active:   supplier.is_active,
    total_purchases_paisa,
    total_paid_paisa,
    balance_paisa: total_purchases_paisa - total_paid_paisa,
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
  const body = await request.json()

  const { name, phone, address, notes, is_active } = body

  if (name !== undefined && !name?.trim()) {
    return NextResponse.json(
      { error: 'Supplier name is required' },
      { status: 400 }
    )
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (name       !== undefined) updates.name      = name.trim()
  if (phone      !== undefined) updates.phone     = phone?.trim()   || null
  if (address    !== undefined) updates.address   = address?.trim() || null
  if (notes      !== undefined) updates.notes     = notes?.trim()   || null
  if (is_active  !== undefined) updates.is_active = is_active

  let updateQuery = supabase
    .from('suppliers')
    .update(updates)
    .eq('id', id)
  if (tenantId) updateQuery = updateQuery.eq('tenant_id', tenantId)

  const { data, error } = await updateQuery.select().single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
