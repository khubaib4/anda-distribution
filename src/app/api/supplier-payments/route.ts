import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'
import { recalculateSupplierPurchaseAllocations } from '@/lib/supplier-payment-allocation'

export async function GET(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const supplierId = searchParams.get('supplier_id')

  let query = supabase
    .from('supplier_payments')
    .select('*')
    .order('payment_date', { ascending: false })

  query = tenantEq(query, tenantId)
  if (supplierId) query = query.eq('supplier_id', supplierId)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
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
    supplier_id,
    amount_paisa,
    payment_date,
    payment_method,
    reference,
    notes,
    bank_account_id,
  } = body

  if (typeof supplier_id !== 'string' || !supplier_id.trim()) {
    return NextResponse.json(
      { error: 'Supplier is required' },
      { status: 400 }
    )
  }
  if (!Number.isSafeInteger(amount_paisa) || amount_paisa <= 0) {
    return NextResponse.json(
      { error: 'Amount must be a positive, safe integer number of paisa' },
      { status: 400 }
    )
  }

  const { data: supplier, error: supplierError } = await supabase
    .from('suppliers')
    .select('id')
    .eq('id', supplier_id)
    .eq('tenant_id', writeTenantId)
    .maybeSingle()

  if (supplierError) {
    return NextResponse.json({ error: supplierError.message }, { status: 500 })
  }
  if (!supplier) {
    return NextResponse.json({ error: 'Supplier not found' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('supplier_payments')
    .insert({
      tenant_id:       writeTenantId,
      supplier_id,
      amount_paisa,
      payment_date:    payment_date    || new Date().toISOString().split('T')[0],
      payment_method:  payment_method  || null,
      reference:       reference       || null,
      notes:           notes           || null,
      bank_account_id: bank_account_id || null,
      created_by:      user?.id        || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  try {
    const allocation = await recalculateSupplierPurchaseAllocations({
      supabase,
      tenantId: writeTenantId,
      supplierId: supplier_id,
    })

    return NextResponse.json({ ...data, allocation }, { status: 201 })
  } catch (allocationError) {
    console.error('Supplier payment saved but FIFO allocation failed', {
      tenantId: writeTenantId,
      supplierId: supplier_id,
      paymentId: data.id,
      error: allocationError,
    })

    return NextResponse.json(
      {
        ...data,
        allocation_warning:
          'Payment was recorded, but purchase payment statuses could not be updated automatically. Do not record this payment again.',
      },
      { status: 201 },
    )
  }
}
