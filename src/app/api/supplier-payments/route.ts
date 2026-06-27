import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const supplierId = searchParams.get('supplier_id')

  let query = supabase
    .from('supplier_payments')
    .select('*')
    .order('payment_date', { ascending: false })

  if (supplierId) query = query.eq('supplier_id', supplierId)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: Request) {
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
      supplier_id,
      amount_paisa,
      payment_date:   payment_date   || new Date().toISOString().split('T')[0],
      payment_method: payment_method || null,
      reference:      reference      || null,
      notes:          notes          || null,
      created_by:     user?.id       || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
