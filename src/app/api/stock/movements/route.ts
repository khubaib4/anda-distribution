import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)

  const categoryId = searchParams.get('category_id')
  const from       = searchParams.get('from')
  const to         = searchParams.get('to')
  const limit      = parseInt(searchParams.get('limit') ?? '50')

  let query = supabase
    .from('stock_movements')
    .select(`
      *,
      egg_category:egg_categories(id, name)
    `)
    .order('movement_date', { ascending: false })
    .order('created_at',    { ascending: false })
    .limit(limit)

  if (categoryId) query = query.eq('egg_category_id', categoryId)
  if (from)       query = query.gte('movement_date', from)
  if (to)         query = query.lte('movement_date', to)

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
    egg_category_id,
    movement_type,
    quantity_peti,
    quantity_tray,
    notes,
    movement_date,
  } = body

  if (!egg_category_id) {
    return NextResponse.json(
      { error: 'Egg category is required' },
      { status: 400 }
    )
  }

  const quantity_trays = (parseInt(quantity_peti) || 0) * 12
    + (parseInt(quantity_tray) || 0)

  if (quantity_trays <= 0) {
    return NextResponse.json(
      { error: 'Quantity must be greater than 0' },
      { status: 400 }
    )
  }

  if (!['adjustment_in', 'adjustment_out', 'opening_stock'].includes(movement_type)) {
    return NextResponse.json(
      { error: 'Invalid movement type' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('stock_movements')
    .insert({
      egg_category_id,
      movement_type,
      quantity_trays,
      notes:         notes        || null,
      movement_date: movement_date || new Date().toISOString().split('T')[0],
      created_by:    user?.id     || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
