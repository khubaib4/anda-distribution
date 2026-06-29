import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'

export async function GET(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)

  const categoryId = searchParams.get('category_id')
  const from       = searchParams.get('from')
  const to         = searchParams.get('to')

  let query = tenantEq(
    supabase
      .from('expenses')
      .select(`
        *,
        category:expense_categories(id, name, icon)
      `),
    tenantId,
  )
    .order('expense_date', { ascending: false })
    .order('created_at',   { ascending: false })

  if (categoryId) query = query.eq('category_id', categoryId)
  if (from)       query = query.gte('expense_date', from)
  if (to)         query = query.lte('expense_date', to)

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
    category_id,
    amount_paisa,
    expense_date,
    description,
    vehicle,
    odometer_km,
    worker_name,
    labor_type,
    notes,
    bank_account_id,
  } = body

  if (!category_id) {
    return NextResponse.json(
      { error: 'Category is required' },
      { status: 400 }
    )
  }
  if (!amount_paisa || amount_paisa <= 0) {
    return NextResponse.json(
      { error: 'Amount must be greater than 0' },
      { status: 400 }
    )
  }
  if (!description?.trim()) {
    return NextResponse.json(
      { error: 'Description is required' },
      { status: 400 }
    )
  }
  if (!expense_date) {
    return NextResponse.json(
      { error: 'Date is required' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      tenant_id:       writeTenantId,
      category_id,
      amount_paisa,
      expense_date,
      description:     description.trim(),
      vehicle:         vehicle         || null,
      odometer_km:     odometer_km     || null,
      worker_name:     worker_name     || null,
      labor_type:      labor_type      || null,
      notes:           notes           || null,
      bank_account_id: bank_account_id || null,
      created_by:      user?.id        || null,
    })
    .select(`*, category:expense_categories(id, name, icon)`)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
