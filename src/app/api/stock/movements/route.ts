import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { isPositiveWholeEggCount, wholeEggsFromTrays } from '@/lib/quantity'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'
import { validateOutboundStockAvailability } from '@/lib/stock-availability'
import { businessDateString } from '@/lib/business-date'

export async function GET(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)

  const categoryId = searchParams.get('category_id')
  const from       = searchParams.get('from')
  const to         = searchParams.get('to')
  const limit      = parseInt(searchParams.get('limit') ?? '50')

  let query = tenantEq(
    supabase
      .from('stock_movements')
      .select(`
        *,
        egg_category:egg_categories(id, name)
      `),
    tenantId,
  )
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
  const auth = await authorizeApi(request, { permission: 'stock' })
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
    egg_category_id,
    movement_type,
    quantity_unit,
    quantity_trays: inputTrays,
    quantity_eggs:  inputEggs,
    reason,
    price_per_egg_paisa,
    notes,
    movement_date,
  } = body

  if (!egg_category_id) {
    return NextResponse.json(
      { error: 'Egg category is required' },
      { status: 400 },
    )
  }

  if (!['adjustment_in', 'adjustment_out', 'opening_stock'].includes(movement_type)) {
    return NextResponse.json(
      { error: 'Invalid movement type' },
      { status: 400 },
    )
  }

  if (!['eggs', 'trays'].includes(quantity_unit)) {
    return NextResponse.json(
      { error: 'Invalid quantity unit' },
      { status: 400 },
    )
  }

  let quantity_eggs: number

  if (quantity_unit === 'eggs') {
    if (!isPositiveWholeEggCount(inputEggs)) {
      return NextResponse.json(
        { error: 'Egg quantity must be a whole number greater than 0' },
        { status: 400 },
      )
    }
    quantity_eggs = inputEggs
  } else {
    const wholeEggs = wholeEggsFromTrays(inputTrays)
    if (wholeEggs === null) {
      return NextResponse.json(
        { error: 'Tray quantity must equal a whole number of eggs greater than 0' },
        { status: 400 },
      )
    }
    quantity_eggs = wholeEggs
  }
  // Eggs are exact; the legacy tray field only describes complete trays.
  const quantity_trays = quantity_eggs % 30 === 0 ? quantity_eggs / 30 : null

  if (movement_type === 'adjustment_out') {
    const availability = await validateOutboundStockAvailability({
      supabase,
      tenantId: writeTenantId,
      eggCategoryId: egg_category_id,
      requestedEggs: quantity_eggs,
    })

    if (availability.invalidReason) {
      return NextResponse.json(
        { error: availability.invalidReason },
        { status: 400 },
      )
    }

    if (availability.insufficientStock) {
      return NextResponse.json(
        {
          error: 'Insufficient stock',
          insufficient_stock: availability.insufficientStock,
        },
        { status: 409 },
      )
    }
  } else {
    const { data: category, error: categoryError } = await supabase
      .from('egg_categories')
      .select('id')
      .eq('tenant_id', writeTenantId)
      .eq('id', egg_category_id)
      .maybeSingle()

    if (categoryError) {
      return NextResponse.json({ error: categoryError.message }, { status: 500 })
    }

    if (!category) {
      return NextResponse.json(
        { error: 'Egg category does not belong to this tenant' },
        { status: 400 },
      )
    }
  }

  const { data, error } = await supabase
    .from('stock_movements')
    .insert({
      tenant_id:           writeTenantId,
      egg_category_id,
      movement_type,
      quantity_trays,
      quantity_eggs,
      reason:              reason              || null,
      price_per_egg_paisa: price_per_egg_paisa ?? 0,
      notes:               notes               || null,
      movement_date:       movement_date       || businessDateString(),
      created_by:          user?.id            || null,
    })
    .select()
    .single()

  if (error) {
    // The database rechecks after other stock writers finish. A preview can
    // pass and still lose this race, without saving any part of the movement.
    if (error.code === '23514') {
      return NextResponse.json({ error: 'Insufficient stock. Review the available quantity and try again.' }, { status: 409 })
    }
    if (['40P01', '40001', '55P03'].includes(error.code ?? '')) {
      return NextResponse.json({ error: 'Stock changed while saving. Review stock and try again.' }, { status: 409 })
    }
    const status = error.code === '42501' ? 403
      : ['22023', '22P02', '22003', '23503'].includes(error.code ?? '') ? 400 : 500
    return NextResponse.json({ error: error.message }, { status })
  }

  return NextResponse.json(data, { status: 201 })
}
