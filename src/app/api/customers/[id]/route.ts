import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('customer_balances')
    .select('*')
    .eq('customer_id', id)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { data, error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
