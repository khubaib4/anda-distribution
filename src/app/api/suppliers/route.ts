import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: Request) {
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
      name:    name.trim(),
      phone:   phone?.trim()   || null,
      address: address?.trim() || null,
      notes:   notes?.trim()   || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
