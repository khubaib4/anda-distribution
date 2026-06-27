import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('purchases')
    .select(`
      *,
      supplier:suppliers(id, name, phone),
      items:purchase_items(
        id,
        quantity_trays,
        price_per_tray_paisa,
        egg_category:egg_categories(id, name)
      )
    `)
    .eq('id', id)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const enriched = {
    ...data,
    total_paisa: (data.items ?? []).reduce(
      (sum: number, item: { quantity_trays: number; price_per_tray_paisa: number }) =>
        sum + item.quantity_trays * item.price_per_tray_paisa,
      0
    ),
  }

  return NextResponse.json(enriched)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase  = await createClient()
  const body      = await request.json()

  const { payment_status, amount_paid_paisa, notes } = body

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (payment_status    !== undefined) updates.payment_status    = payment_status
  if (amount_paid_paisa !== undefined) updates.amount_paid_paisa = amount_paid_paisa
  if (notes             !== undefined) updates.notes             = notes

  const { data, error } = await supabase
    .from('purchases')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
