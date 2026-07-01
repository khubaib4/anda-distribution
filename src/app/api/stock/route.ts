import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi } from '@/lib/tenant-api'

const IN_TYPES = ['purchase_in', 'adjustment_in', 'opening_stock'] as const

function movementEggs(
  quantity_eggs: number | null,
  quantity_trays: number | null,
): number {
  if ((quantity_eggs ?? 0) > 0) return quantity_eggs!
  return (quantity_trays ?? 0) * 30
}

export async function GET(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const supabase = await createClient()

  const { data: categories, error: catError } = await supabase
    .from('egg_categories')
    .select('id, name, display_order')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('display_order')

  if (catError) {
    return NextResponse.json({ error: catError.message }, { status: 500 })
  }

  const { data: movements, error: movError } = await supabase
    .from('stock_movements')
    .select('egg_category_id, movement_type, quantity_trays, quantity_eggs')
    .eq('tenant_id', tenantId)

  if (movError) {
    return NextResponse.json({ error: movError.message }, { status: 500 })
  }

  const stockMap: Record<string, number> = {}

  for (const movement of movements ?? []) {
    const eggs = movementEggs(movement.quantity_eggs, movement.quantity_trays)
    const isIn = IN_TYPES.includes(
      movement.movement_type as (typeof IN_TYPES)[number],
    )

    if (!stockMap[movement.egg_category_id]) {
      stockMap[movement.egg_category_id] = 0
    }

    stockMap[movement.egg_category_id] += isIn ? eggs : -eggs
  }

  const result = (categories ?? []).map(cat => {
    const quantity_eggs  = stockMap[cat.id] ?? 0
    const quantity_trays = quantity_eggs / 30

    return {
      egg_category_id:      cat.id,
      egg_category:         cat.name,
      display_order:        cat.display_order,
      quantity_eggs,
      quantity_trays,
      quantity_peti_approx: Math.floor(quantity_trays / 12),
    }
  })

  return NextResponse.json(result)
}
