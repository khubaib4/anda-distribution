import type { SupabaseClient } from '@supabase/supabase-js'
import { computeSaleTotalPaisa } from '@/lib/utils'

type AllocationStatus = 'paid' | 'partial' | 'unpaid'

type PaymentRow = {
  amount_paisa: number | null
}

type SaleItemRow = {
  quantity_trays: number
  price_per_tray_paisa: number
  discounted_price_paisa?: number | null
}

type SaleRow = {
  id: string
  customer_id: string
  sale_date: string
  created_at: string
  payment_status: AllocationStatus
  amount_paid_paisa: number | null
  discount_amount_paisa?: number | null
  items?: SaleItemRow[] | null
}

export type CustomerSaleAllocationSummary = {
  updatedSales: number
  totalPaymentsPaisa: number
  totalAllocatedPaisa: number
  unallocatedPaisa: number
}

function paisa(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.trunc(value)
}

function compareSalesFifo(a: SaleRow, b: SaleRow): number {
  const bySaleDate = a.sale_date.localeCompare(b.sale_date)
  if (bySaleDate !== 0) return bySaleDate

  const byCreatedAt = a.created_at.localeCompare(b.created_at)
  if (byCreatedAt !== 0) return byCreatedAt

  return a.id.localeCompare(b.id)
}

export async function recalculateCustomerSaleAllocations({
  supabase,
  tenantId,
  customerId,
}: {
  supabase: SupabaseClient
  tenantId: string
  customerId: string
}): Promise<CustomerSaleAllocationSummary> {
  const { data: paymentsData, error: paymentsError } = await supabase
    .from('customer_payments')
    .select('amount_paisa')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)

  if (paymentsError) throw paymentsError

  const totalPaymentsPaisa = ((paymentsData ?? []) as PaymentRow[]).reduce(
    (sum, payment) => sum + paisa(payment.amount_paisa),
    0,
  )

  const { data: salesData, error: salesError } = await supabase
    .from('sales')
    .select(`
      id,
      customer_id,
      sale_date,
      created_at,
      payment_status,
      amount_paid_paisa,
      discount_amount_paisa,
      items:sale_items(
        quantity_trays,
        price_per_tray_paisa,
        discounted_price_paisa
      )
    `)
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)

  if (salesError) throw salesError

  const sales = ((salesData ?? []) as SaleRow[]).sort(compareSalesFifo)
  let remaining = totalPaymentsPaisa
  let totalAllocatedPaisa = 0
  let updatedSales = 0

  for (const sale of sales) {
    const items = (sale.items ?? []).map((item) => ({
      quantity_trays: item.quantity_trays,
      price_per_tray_paisa: item.price_per_tray_paisa,
      discounted_price_paisa: item.discounted_price_paisa ?? undefined,
    }))

    const totalPaisa = Math.max(
      0,
      computeSaleTotalPaisa({
        discount_amount_paisa: sale.discount_amount_paisa ?? 0,
        items,
      }),
    )

    const allocatedPaisa = Math.max(0, Math.min(remaining, totalPaisa))
    remaining -= allocatedPaisa
    totalAllocatedPaisa += allocatedPaisa

    const payment_status: AllocationStatus =
      allocatedPaisa <= 0
        ? 'unpaid'
        : allocatedPaisa >= totalPaisa
          ? 'paid'
          : 'partial'

    if (
      sale.payment_status === payment_status &&
      paisa(sale.amount_paid_paisa) === allocatedPaisa
    ) {
      continue
    }

    const { error: updateError } = await supabase
      .from('sales')
      .update({
        payment_status,
        amount_paid_paisa: allocatedPaisa,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sale.id)
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)

    if (updateError) throw updateError
    updatedSales += 1
  }

  return {
    updatedSales,
    totalPaymentsPaisa,
    totalAllocatedPaisa,
    unallocatedPaisa: Math.max(0, remaining),
  }
}
