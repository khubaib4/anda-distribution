import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { traysToEggs } from '@/lib/utils'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'
import { validateOutboundStockAvailability } from '@/lib/stock-availability'

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
  let quantity_trays: number

  if (quantity_unit === 'eggs') {
    quantity_eggs = Number(inputEggs)
    if (
      !Number.isFinite(quantity_eggs) ||
      quantity_eggs <= 0 ||
      !Number.isInteger(quantity_eggs)
    ) {
      return NextResponse.json(
        { error: 'Egg quantity must be a whole number greater than 0' },
        { status: 400 },
      )
    }
    quantity_trays = Math.ceil(quantity_eggs / 30)
  } else {
    quantity_trays = Number(inputTrays)
    if (!Number.isFinite(quantity_trays) || quantity_trays <= 0) {
      return NextResponse.json(
        { error: 'Quantity must be greater than 0' },
        { status: 400 },
      )
    }
    quantity_eggs = traysToEggs(quantity_trays)
  }

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
      movement_date:       movement_date       || new Date().toISOString().split('T')[0],
      created_by:          user?.id            || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
