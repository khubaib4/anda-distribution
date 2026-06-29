import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'

function purchaseTotalPaisa(items: { quantity_trays: number; price_per_tray_paisa: number }[]) {
  return (items ?? []).reduce(
    (sum, item) => sum + item.quantity_trays * item.price_per_tray_paisa,
    0,
  )
}

export async function GET(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const supabase = await createClient()

  let suppliersQuery = supabase
    .from('suppliers')
    .select('id, name, phone, is_active')
    .order('name')
  suppliersQuery = tenantEq(suppliersQuery, tenantId)

  const { data: suppliers, error: suppliersError } = await suppliersQuery

  if (suppliersError) {
    return NextResponse.json({ error: suppliersError.message }, { status: 500 })
  }

  let purchasesQuery = supabase
    .from('purchases')
    .select(`
      supplier_id,
      items:purchase_items(quantity_trays, price_per_tray_paisa)
    `)
  purchasesQuery = tenantEq(purchasesQuery, tenantId)

  const { data: purchases, error: purchasesError } = await purchasesQuery

  if (purchasesError) {
    return NextResponse.json({ error: purchasesError.message }, { status: 500 })
  }

  let paymentsQuery = supabase
    .from('supplier_payments')
    .select('supplier_id, amount_paisa')
  paymentsQuery = tenantEq(paymentsQuery, tenantId)

  const { data: payments, error: paymentsError } = await paymentsQuery

  if (paymentsError) {
    return NextResponse.json({ error: paymentsError.message }, { status: 500 })
  }

  const purchasesBySupplier = new Map<string, number>()
  for (const purchase of purchases ?? []) {
    if (!purchase.supplier_id) continue
    const total = purchaseTotalPaisa(purchase.items ?? [])
    purchasesBySupplier.set(
      purchase.supplier_id,
      (purchasesBySupplier.get(purchase.supplier_id) ?? 0) + total,
    )
  }

  const paidBySupplier = new Map<string, number>()
  for (const payment of payments ?? []) {
    paidBySupplier.set(
      payment.supplier_id,
      (paidBySupplier.get(payment.supplier_id) ?? 0) + payment.amount_paisa,
    )
  }

  const data = (suppliers ?? []).map(s => {
    const total_purchases_paisa = purchasesBySupplier.get(s.id) ?? 0
    const total_paid_paisa = paidBySupplier.get(s.id) ?? 0
    return {
      supplier_id: s.id,
      name:        s.name,
      phone:       s.phone,
      is_active:   s.is_active,
      total_purchases_paisa,
      total_paid_paisa,
      balance_paisa: total_purchases_paisa - total_paid_paisa,
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
  const body = await request.json()

  const { name, phone, address, notes } = body

  if (!name?.trim()) {
    return NextResponse.json(
      { error: 'Supplier name is required' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('suppliers')
    .insert({
      tenant_id: writeTenantId,
      name:      name.trim(),
      phone:     phone?.trim()   || null,
      address:   address?.trim() || null,
      notes:     notes?.trim()   || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
