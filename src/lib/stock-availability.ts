import type { SupabaseClient } from '@supabase/supabase-js'

const IN_TYPES = ['purchase_in', 'adjustment_in', 'opening_stock'] as const

type SaleStockItem = {
  egg_category_id: string
  quantity_trays: number
}

type StockMovementRow = {
  egg_category_id: string
  movement_type: string
  quantity_trays: number | null
  quantity_eggs: number | null
}

export type InsufficientStockItem = {
  egg_category_id: string
  available_trays: number
  requested_trays: number
  shortage_trays: number
}

export type InvalidStockItem = {
  egg_category_id?: string
  reason: string
}

export type SaleStockAvailabilityResult = {
  ok: boolean
  insufficientStock: InsufficientStockItem[]
  invalidItems: InvalidStockItem[]
}

function isInbound(movementType: string): boolean {
  return IN_TYPES.includes(movementType as (typeof IN_TYPES)[number])
}

function movementEggs(movement: StockMovementRow): number {
  if (
    typeof movement.quantity_eggs === 'number' &&
    Number.isFinite(movement.quantity_eggs) &&
    movement.quantity_eggs !== 0
  ) {
    return movement.quantity_eggs
  }

  if (
    typeof movement.quantity_trays === 'number' &&
    Number.isFinite(movement.quantity_trays)
  ) {
    return movement.quantity_trays * 30
  }

  return 0
}

function roundTrays(value: number): number {
  return Math.round(value * 1000) / 1000
}

function addToMap(map: Map<string, number>, categoryId: string, eggs: number) {
  map.set(categoryId, (map.get(categoryId) ?? 0) + eggs)
}

export async function validateSaleStockAvailability({
  supabase,
  tenantId,
  items,
  existingSaleId,
}: {
  supabase: SupabaseClient
  tenantId: string
  items: SaleStockItem[]
  existingSaleId?: string
}): Promise<SaleStockAvailabilityResult> {
  const invalidItems: InvalidStockItem[] = []
  const requestedEggsByCategory = new Map<string, number>()

  for (const item of items) {
    if (!item.egg_category_id) {
      invalidItems.push({ reason: 'Egg category is required' })
      continue
    }

    if (
      typeof item.quantity_trays !== 'number' ||
      !Number.isFinite(item.quantity_trays) ||
      item.quantity_trays <= 0
    ) {
      invalidItems.push({
        egg_category_id: item.egg_category_id,
        reason: 'Quantity must be greater than 0',
      })
      continue
    }

    addToMap(
      requestedEggsByCategory,
      item.egg_category_id,
      item.quantity_trays * 30,
    )
  }

  const requestedCategoryIds = [...requestedEggsByCategory.keys()]

  if (requestedCategoryIds.length === 0) {
    return { ok: false, insufficientStock: [], invalidItems }
  }

  const { data: categories, error: categoryError } = await supabase
    .from('egg_categories')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('id', requestedCategoryIds)

  if (categoryError) throw categoryError

  const validCategoryIds = new Set(
    ((categories ?? []) as { id: string }[]).map(category => category.id),
  )

  for (const categoryId of requestedCategoryIds) {
    if (!validCategoryIds.has(categoryId)) {
      invalidItems.push({
        egg_category_id: categoryId,
        reason: 'Egg category does not belong to this tenant',
      })
    }
  }

  if (invalidItems.length > 0) {
    return { ok: false, insufficientStock: [], invalidItems }
  }

  const { data: movements, error: movementsError } = await supabase
    .from('stock_movements')
    .select('egg_category_id, movement_type, quantity_trays, quantity_eggs')
    .eq('tenant_id', tenantId)
    .in('egg_category_id', requestedCategoryIds)

  if (movementsError) throw movementsError

  const availableEggsByCategory = new Map<string, number>()

  for (const movement of (movements ?? []) as StockMovementRow[]) {
    const eggs = movementEggs(movement)
    addToMap(
      availableEggsByCategory,
      movement.egg_category_id,
      isInbound(movement.movement_type) ? eggs : -eggs,
    )
  }

  if (existingSaleId) {
    const { data: existingSaleMovements, error: existingMovementsError } =
      await supabase
        .from('stock_movements')
        .select('egg_category_id, movement_type, quantity_trays, quantity_eggs')
        .eq('tenant_id', tenantId)
        .eq('reference_id', existingSaleId)
        .eq('movement_type', 'sale_out')
        .in('egg_category_id', requestedCategoryIds)

    if (existingMovementsError) throw existingMovementsError

    for (const movement of (existingSaleMovements ?? []) as StockMovementRow[]) {
      addToMap(
        availableEggsByCategory,
        movement.egg_category_id,
        movementEggs(movement),
      )
    }
  }

  const insufficientStock: InsufficientStockItem[] = []

  for (const [categoryId, requestedEggs] of requestedEggsByCategory) {
    const availableEggs = availableEggsByCategory.get(categoryId) ?? 0

    if (requestedEggs > availableEggs) {
      insufficientStock.push({
        egg_category_id: categoryId,
        available_trays: roundTrays(availableEggs / 30),
        requested_trays: roundTrays(requestedEggs / 30),
        shortage_trays: roundTrays((requestedEggs - availableEggs) / 30),
      })
    }
  }

  return {
    ok: insufficientStock.length === 0,
    insufficientStock,
    invalidItems: [],
  }
}
