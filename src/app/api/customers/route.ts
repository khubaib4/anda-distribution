import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const type     = searchParams.get('type')
  const inactive = searchParams.get('inactive') === 'true'

  let query = supabase
    .from('customer_balances')
    .select('*')
    .order('contact_name')

  if (!inactive) query = query.eq('is_active', true)
  if (type)      query = query.eq('customer_type', type)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: Request) {
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
