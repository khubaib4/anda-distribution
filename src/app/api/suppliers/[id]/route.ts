import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('supplier_balances')
    .select('*')
    .eq('supplier_id', id)
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

  const { data, error } = await supabase
    .from('suppliers')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
