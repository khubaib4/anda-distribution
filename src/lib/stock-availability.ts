import type { SupabaseClient } from '@supabase/supabase-js'
import { isPositiveWholeEggCount, wholeEggsFromWholeTrays } from './quantity'

const IN_TYPES = ['purchase_in', 'adjustment_in', 'opening_stock'] as const

type SaleStockItem = {
  egg_category_id: string
  quantity_trays: number
}

type PurchaseStockItem = {
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

export type InsufficientOutboundStockItem = {
  egg_category_id: string
  available_eggs: number
  requested_eggs: number
  shortage_eggs: number
  available_trays: number
  requested_trays: number
  shortage_trays: number
}

export type OutboundStockAvailabilityResult = {
  ok: boolean
  invalidReason?: string
  insufficientStock?: InsufficientOutboundStockItem
}

export type InsufficientPurchaseEditStockItem = {
  egg_category_id: string
  current_available_trays: number
  old_purchase_trays: number
  new_purchase_trays: number
  projected_available_trays: number
  shortage_trays: number
}

export type PurchaseEditStockAvailabilityResult = {
  ok: boolean
  invalidItems: InvalidStockItem[]
  insufficientStock: InsufficientPurchaseEditStockItem[]
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
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      typeof item.egg_category_id !== 'string' ||
      !item.egg_category_id
    ) {
      invalidItems.push({ reason: 'Egg category is required' })
      continue
    }

    const requestedEggs = wholeEggsFromWholeTrays(item.quantity_trays)
    if (requestedEggs === null) {
      invalidItems.push({
        egg_category_id: item.egg_category_id,
        reason: 'Quantity must be a positive whole number of trays',
      })
      continue
    }

    addToMap(
      requestedEggsByCategory,
      item.egg_category_id,
      requestedEggs,
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

export async function validateOutboundStockAvailability({
  supabase,
  tenantId,
  eggCategoryId,
  requestedEggs,
}: {
  supabase: SupabaseClient
  tenantId: string
  eggCategoryId: string
  requestedEggs: number
}): Promise<OutboundStockAvailabilityResult> {
  if (!eggCategoryId) {
    return { ok: false, invalidReason: 'Egg category is required' }
  }

  if (!isPositiveWholeEggCount(requestedEggs)) {
    return { ok: false, invalidReason: 'Quantity must be a positive whole number of eggs' }
  }

  const { data: category, error: categoryError } = await supabase
    .from('egg_categories')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('id', eggCategoryId)
    .maybeSingle()

  if (categoryError) throw categoryError

  if (!category) {
    return {
      ok: false,
      invalidReason: 'Egg category does not belong to this tenant',
    }
  }

  const { data: movements, error: movementsError } = await supabase
    .from('stock_movements')
    .select('egg_category_id, movement_type, quantity_trays, quantity_eggs')
    .eq('tenant_id', tenantId)
    .eq('egg_category_id', eggCategoryId)

  if (movementsError) throw movementsError

  let availableEggs = 0

  for (const movement of (movements ?? []) as StockMovementRow[]) {
    const eggs = movementEggs(movement)
    availableEggs += isInbound(movement.movement_type) ? eggs : -eggs
  }

  if (requestedEggs > availableEggs) {
    return {
      ok: false,
      insufficientStock: {
        egg_category_id: eggCategoryId,
        available_eggs: availableEggs,
        requested_eggs: requestedEggs,
        shortage_eggs: requestedEggs - availableEggs,
        available_trays: roundTrays(availableEggs / 30),
        requested_trays: roundTrays(requestedEggs / 30),
        shortage_trays: roundTrays((requestedEggs - availableEggs) / 30),
      },
    }
  }

  return { ok: true }
}

export async function validatePurchaseEditStockAvailability({
  supabase,
  tenantId,
  purchaseId,
  items,
}: {
  supabase: SupabaseClient
  tenantId: string
  purchaseId: string
  items: PurchaseStockItem[]
}): Promise<PurchaseEditStockAvailabilityResult> {
  const invalidItems: InvalidStockItem[] = []
  const newPurchaseEggsByCategory = new Map<string, number>()

  for (const item of items) {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      typeof item.egg_category_id !== 'string' ||
      !item.egg_category_id
    ) {
      invalidItems.push({ reason: 'Egg category is required' })
      continue
    }

    const requestedEggs = wholeEggsFromWholeTrays(item.quantity_trays)
    if (requestedEggs === null) {
      invalidItems.push({
        egg_category_id: item.egg_category_id,
        reason: 'Quantity must be a positive whole number of trays',
      })
      continue
    }

    addToMap(
      newPurchaseEggsByCategory,
      item.egg_category_id,
      requestedEggs,
    )
  }

  const newCategoryIds = [...newPurchaseEggsByCategory.keys()]

  if (newCategoryIds.length === 0) {
    return { ok: false, invalidItems, insufficientStock: [] }
  }

  const { data: categories, error: categoryError } = await supabase
    .from('egg_categories')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('id', newCategoryIds)

  if (categoryError) throw categoryError

  const validCategoryIds = new Set(
    ((categories ?? []) as { id: string }[]).map(category => category.id),
  )

  for (const categoryId of newCategoryIds) {
    if (!validCategoryIds.has(categoryId)) {
      invalidItems.push({
        egg_category_id: categoryId,
        reason: 'Egg category does not belong to this tenant',
      })
    }
  }

  if (invalidItems.length > 0) {
    return { ok: false, invalidItems, insufficientStock: [] }
  }

  const { data: oldPurchaseMovements, error: oldMovementsError } =
    await supabase
      .from('stock_movements')
      .select('egg_category_id, movement_type, quantity_trays, quantity_eggs')
      .eq('tenant_id', tenantId)
      .eq('reference_id', purchaseId)
      .eq('movement_type', 'purchase_in')

  if (oldMovementsError) throw oldMovementsError

  const oldPurchaseEggsByCategory = new Map<string, number>()

  for (const movement of (oldPurchaseMovements ?? []) as StockMovementRow[]) {
    addToMap(
      oldPurchaseEggsByCategory,
      movement.egg_category_id,
      movementEggs(movement),
    )
  }

  const affectedCategoryIds = [
    ...new Set([
      ...newPurchaseEggsByCategory.keys(),
      ...oldPurchaseEggsByCategory.keys(),
    ]),
  ]

  const { data: movements, error: movementsError } = await supabase
    .from('stock_movements')
    .select('egg_category_id, movement_type, quantity_trays, quantity_eggs')
    .eq('tenant_id', tenantId)
    .in('egg_category_id', affectedCategoryIds)

  if (movementsError) throw movementsError

  const currentAvailableEggsByCategory = new Map<string, number>()

  for (const movement of (movements ?? []) as StockMovementRow[]) {
    const eggs = movementEggs(movement)
    addToMap(
      currentAvailableEggsByCategory,
      movement.egg_category_id,
      isInbound(movement.movement_type) ? eggs : -eggs,
    )
  }

  const insufficientStock: InsufficientPurchaseEditStockItem[] = []

  for (const categoryId of affectedCategoryIds) {
    const currentAvailableEggs =
      currentAvailableEggsByCategory.get(categoryId) ?? 0
    const oldPurchaseEggs = oldPurchaseEggsByCategory.get(categoryId) ?? 0
    const newPurchaseEggs = newPurchaseEggsByCategory.get(categoryId) ?? 0
    const projectedAvailableEggs =
      currentAvailableEggs - oldPurchaseEggs + newPurchaseEggs

    if (projectedAvailableEggs < 0) {
      insufficientStock.push({
        egg_category_id: categoryId,
        current_available_trays: roundTrays(currentAvailableEggs / 30),
        old_purchase_trays: roundTrays(oldPurchaseEggs / 30),
        new_purchase_trays: roundTrays(newPurchaseEggs / 30),
        projected_available_trays: roundTrays(projectedAvailableEggs / 30),
        shortage_trays: roundTrays(-projectedAvailableEggs / 30),
      })
    }
  }

  return {
    ok: insufficientStock.length === 0,
    invalidItems: [],
    insufficientStock,
  }
}
