import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq } from '@/lib/tenant-api'

const IN_TYPES  = new Set(['purchase_in', 'adjustment_in', 'opening_stock'])
const OUT_TYPES = new Set(['sale_out', 'adjustment_out'])

function movementEggs(quantity_eggs: number | null, quantity_trays: number | null): number {
  return quantity_eggs ?? (quantity_trays ?? 0) * 30
}

export async function GET(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const supabase = await createClient()

  const { data: categories, error: catError } = await tenantEq(
    supabase
      .from('egg_categories')
      .select('id, name, display_order')
      .eq('is_active', true),
    tenantId,
  ).order('display_order')

  if (catError) {
    return NextResponse.json({ error: catError.message }, { status: 500 })
  }

  const { data: movements, error: movError } = await tenantEq(
    supabase
      .from('stock_movements')
      .select('egg_category_id, movement_type, quantity_eggs, quantity_trays'),
    tenantId,
  )

  if (movError) {
    return NextResponse.json({ error: movError.message }, { status: 500 })
  }

  const stockByCategory = new Map<string, number>()

  for (const m of movements ?? []) {
    const eggs = movementEggs(m.quantity_eggs, m.quantity_trays)
    const current = stockByCategory.get(m.egg_category_id) ?? 0

    if (IN_TYPES.has(m.movement_type)) {
      stockByCategory.set(m.egg_category_id, current + eggs)
    } else if (OUT_TYPES.has(m.movement_type)) {
      stockByCategory.set(m.egg_category_id, current - eggs)
    }
  }

  const result = (categories ?? []).map(cat => {
    const quantity_eggs  = stockByCategory.get(cat.id) ?? 0
    const quantity_trays = quantity_eggs / 30

    return {
      egg_category_id:      cat.id,
      egg_category:         cat.name,
      quantity_eggs,
      quantity_trays,
      display_order:        cat.display_order,
      quantity_peti_approx: Math.floor(quantity_trays / 12),
    }
  })

  return NextResponse.json(result)
}
