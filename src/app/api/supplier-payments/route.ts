import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'

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

  if (!supplier_id) {
    return NextResponse.json(
      { error: 'Supplier is required' },
      { status: 400 }
    )
  }
  if (!amount_paisa || amount_paisa <= 0) {
    return NextResponse.json(
      { error: 'Amount must be greater than 0' },
      { status: 400 }
    )
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

  return NextResponse.json(data, { status: 201 })
}
