import { itemBaseLineTotalPaisa } from '@/lib/peti-pricing'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TrustedHeaderWriter } from '@/lib/supabase/trusted-header-writer'

type AllocationStatus = 'paid' | 'partial' | 'unpaid'

type PaymentRow = {
  amount_paisa: number
}

type PurchaseRow = {
  id: string
  purchase_date: string
  created_at: string
  payment_status: AllocationStatus
  amount_paid_paisa: number | null
}

type PurchaseItemRow = {
  purchase_id: string
  quantity_trays: number
  price_per_tray_paisa: number
  price_per_peti_paisa?: number | null
}

export type SupplierPurchaseAllocationSummary = {
  updatedPurchases: number
  totalPaymentsPaisa: number
  totalAllocatedPaisa: number
  unallocatedPaisa: number
}

const PAGE_SIZE = 500
const PURCHASE_ID_BATCH_SIZE = 100

function safePaisa(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${label} in supplier allocation`)
  }
  return value
}

function addPaisa(a: number, b: number, label: string): number {
  return safePaisa(a + b, label)
}

function comparePurchasesFifo(a: PurchaseRow, b: PurchaseRow): number {
  const byDate = a.purchase_date.localeCompare(b.purchase_date)
  if (byDate !== 0) return byDate

  const byCreatedAt = a.created_at.localeCompare(b.created_at)
  if (byCreatedAt !== 0) return byCreatedAt

  return a.id.localeCompare(b.id)
}

export async function recalculateSupplierPurchaseAllocations({
  supabase,
  trustedWriter,
  tenantId,
  supplierId,
}: {
  supabase: SupabaseClient
  trustedWriter: TrustedHeaderWriter
  tenantId: string
  supplierId: string
}): Promise<SupplierPurchaseAllocationSummary> {
  let totalPaymentsPaisa = 0
  let paymentOffset = 0

  while (true) {
    const { data, error } = await supabase
      .from('supplier_payments')
      .select('amount_paisa')
      .eq('tenant_id', tenantId)
      .eq('supplier_id', supplierId)
      .order('id', { ascending: true })
      .range(paymentOffset, paymentOffset + PAGE_SIZE - 1)

    if (error) throw error
    const payments = (data ?? []) as PaymentRow[]
    if (payments.length === 0) break

    for (const payment of payments) {
      totalPaymentsPaisa = addPaisa(
        totalPaymentsPaisa,
        safePaisa(payment.amount_paisa, 'supplier payment amount'),
        'supplier payment total',
      )
    }
    paymentOffset += payments.length
  }

  const purchases: PurchaseRow[] = []
  let purchaseOffset = 0

  while (true) {
    const { data, error } = await supabase
      .from('purchases')
      .select('id, purchase_date, created_at, payment_status, amount_paid_paisa')
      .eq('tenant_id', tenantId)
      .eq('supplier_id', supplierId)
      .order('id', { ascending: true })
      .range(purchaseOffset, purchaseOffset + PAGE_SIZE - 1)

    if (error) throw error
    const page = (data ?? []) as PurchaseRow[]
    if (page.length === 0) break
    purchases.push(...page)
    purchaseOffset += page.length
  }

  const totals = new Map(purchases.map(purchase => [purchase.id, 0]))

  for (let start = 0; start < purchases.length; start += PURCHASE_ID_BATCH_SIZE) {
    const purchaseIds = purchases
      .slice(start, start + PURCHASE_ID_BATCH_SIZE)
      .map(purchase => purchase.id)
    let itemOffset = 0

    while (true) {
      const { data, error } = await supabase
        .from('purchase_items')
        .select('purchase_id, quantity_trays, price_per_tray_paisa, price_per_peti_paisa')
        .eq('tenant_id', tenantId)
        .in('purchase_id', purchaseIds)
        .order('id', { ascending: true })
        .range(itemOffset, itemOffset + PAGE_SIZE - 1)

      if (error) throw error
      const items = (data ?? []) as PurchaseItemRow[]
      if (items.length === 0) break

      for (const item of items) {
        if (!Number.isSafeInteger(item.quantity_trays) || item.quantity_trays < 0) {
          throw new Error('Invalid purchase item quantity in supplier allocation')
        }
        const lineTotal = safePaisa(
          itemBaseLineTotalPaisa({ ...item, price_per_tray_paisa: safePaisa(item.price_per_tray_paisa, 'purchase item price') }),
          'purchase item total',
        )
        const currentTotal = totals.get(item.purchase_id)
        if (currentTotal === undefined) {
          throw new Error('Unexpected purchase item in supplier allocation')
        }
        totals.set(item.purchase_id, addPaisa(currentTotal, lineTotal, 'purchase total'))
      }
      itemOffset += items.length
    }
  }

  for (const purchase of purchases) {
    if (typeof purchase.purchase_date !== 'string' || typeof purchase.created_at !== 'string') {
      throw new Error('Invalid purchase date in supplier allocation')
    }
  }

  purchases.sort(comparePurchasesFifo)
  let remaining = totalPaymentsPaisa
  let totalAllocatedPaisa = 0
  let updatedPurchases = 0

  for (const purchase of purchases) {
    const totalPaisa = totals.get(purchase.id) ?? 0
    const allocatedPaisa = Math.min(remaining, totalPaisa)
    remaining -= allocatedPaisa
    totalAllocatedPaisa += allocatedPaisa

    const payment_status: AllocationStatus =
      allocatedPaisa === 0
        ? 'unpaid'
        : allocatedPaisa >= totalPaisa
          ? 'paid'
          : 'partial'

    if (
      purchase.payment_status === payment_status &&
      purchase.amount_paid_paisa === allocatedPaisa
    ) {
      continue
    }

    await trustedWriter.updatePurchaseStatus({
      tenantId,
      id: purchase.id,
      relatedId: supplierId,
      paymentStatus: payment_status,
      amountPaidPaisa: allocatedPaisa,
    })
    updatedPurchases += 1
  }

  return {
    updatedPurchases,
    totalPaymentsPaisa,
    totalAllocatedPaisa,
    unallocatedPaisa: remaining,
  }
}
