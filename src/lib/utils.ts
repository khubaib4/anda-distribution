import { clsx, type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

// Format PKR from paisa — Pakistani number format (lakh system)
export function formatPKR(paisa: number): string {
  const rupees = paisa / 100
  return (
    '₨\u00A0' +
    rupees.toLocaleString('en-IN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
  )
}

// Format PKR with decimals (for per-unit prices)
export function formatPKRDecimal(paisa: number): string {
  const rupees = paisa / 100
  return (
    '₨\u00A0' +
    rupees.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

// Format trays as peti + tray
// 30 trays → "2 peti 6 tray"
// 24 trays → "2 peti"
// 5 trays  → "5 tray"
export function formatQty(trays: number): string {
  if (trays === 0) return '0 tray'
  const peti = Math.floor(trays / 12)
  const rem = trays % 12
  if (peti === 0) return `${rem} tray`
  if (rem === 0) return `${peti} peti`
  return `${peti} peti ${rem} tray`
}

// Compact version for tables: 2P 6T / 2P / 6T
export function formatQtyCompact(trays: number): string {
  if (trays === 0) return '0T'
  const peti = Math.floor(trays / 12)
  const rem = trays % 12
  if (peti === 0) return `${rem}T`
  if (rem === 0) return `${peti}P`
  return `${peti}P ${rem}T`
}

export function eggsToTrays(eggs: number): number {
  return eggs / 30
}

export function traysToEggs(trays: number): number {
  return trays * 30
}

export function formatEggs(eggs: number): string {
  if (eggs === 0) return '0 eggs'
  if (eggs % 360 === 0) {
    const peti = eggs / 360
    return `${eggs} eggs (${peti} peti)`
  }
  if (eggs % 30 === 0) {
    const trays = eggs / 30
    return `${eggs} eggs (${trays} tray${trays !== 1 ? 's' : ''})`
  }
  if (eggs === 15) {
    return '15 eggs (½ tray)'
  }
  return `${eggs} eggs`
}

export function formatTrayEquivalent(eggs: number): string {
  const trays = eggsToTrays(eggs)
  if (trays === Math.floor(trays)) {
    return `(${trays} tray${trays !== 1 ? 's' : ''})`
  }
  if (trays === 0.5) return '(½ tray)'
  return `(${trays.toFixed(1)} trays)`
}

// Convert peti + tray inputs to trays
export function toTrays(peti: number, tray: number): number {
  return peti * 12 + tray
}

// Convert rupees (user input) to paisa (storage)
export function toPaisa(rupees: number | string): number {
  return Math.round(Number(rupees) * 100)
}

// Convert paisa to rupees (for input field default values)
export function toRupees(paisa: number): number {
  return paisa / 100
}

// Format date: "12 Jun 2025"
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-PK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// Format date short: "12 Jun"
export function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-PK', {
    day: 'numeric',
    month: 'short',
  })
}

// Today as YYYY-MM-DD for date input default values
export function todayString(): string {
  return new Date().toISOString().split('T')[0]
}

export function petiPriceStringFromTrayPaisa(pricePerTrayPaisa: number): string {
  if (!pricePerTrayPaisa) return ''
  const rawPetiPrice = (pricePerTrayPaisa * 12) / 100
  return parseFloat(rawPetiPrice.toFixed(2)).toString()
}

// Generate invoice number
// PUR-20250612-482 or SAL-20250612-482
export function generateInvoiceNumber(prefix: 'PUR' | 'SAL'): string {
  const date = new Date()
  const dateStr = date.toISOString().split('T')[0].replace(/-/g, '')
  const rand = Math.floor(Math.random() * 900 + 100)
  return `${prefix}-${dateStr}-${rand}`
}

// Payment status badge class
export function paymentStatusClass(status: string): string {
  const map: Record<string, string> = {
    paid: 'badge-paid',
    partial: 'badge-partial',
    unpaid: 'badge-unpaid',
  }
  return map[status] ?? 'badge-info'
}

// Payment status label
export function paymentStatusLabel(status: string): string {
  const map: Record<string, string> = {
    paid: 'Paid',
    partial: 'Partial',
    unpaid: 'Unpaid',
  }
  return map[status] ?? status
}

// Customer type label
export function customerTypeLabel(type: string | null): string {
  if (!type) return '—'
  const map: Record<string, string> = {
    shop: 'Shop',
    restaurant: 'Restaurant',
    wholesaler: 'Wholesaler',
    other: 'Other',
  }
  return map[type] ?? type
}

// Truncate text
export function truncate(str: string, n: number): string {
  return str.length > n ? str.slice(0, n - 1) + '…' : str
}

// Check if a value is a positive number
export function isPositiveNumber(val: unknown): boolean {
  return typeof val === 'number' && !isNaN(val) && val > 0
}

export type DiscountType = 'percentage' | 'fixed'

export function computeDiscountedPricePaisa(
  quantityTrays: number,
  pricePerTrayPaisa: number,
  discountType: DiscountType | null,
  discountValue: number,
): number {
  if (
    !discountType ||
    discountValue <= 0 ||
    pricePerTrayPaisa <= 0 ||
    quantityTrays <= 0
  ) {
    return 0
  }

  const lineTotal = quantityTrays * pricePerTrayPaisa
  let discountedTotal: number

  if (discountType === 'percentage') {
    const discountAmount = Math.round(lineTotal * discountValue / 100)
    discountedTotal = Math.max(0, lineTotal - discountAmount)
  } else {
    const fixedAmountPaisa = Math.round(discountValue * 100)
    discountedTotal = Math.max(0, lineTotal - fixedAmountPaisa)
  }

  return Math.round(discountedTotal / quantityTrays)
}

export function computeLineDiscountSavingPaisa(
  quantityTrays: number,
  pricePerTrayPaisa: number,
  discountType: DiscountType | null,
  discountValue: number,
): number {
  if (!discountType || discountValue <= 0 || quantityTrays <= 0) return 0
  const lineTotal = quantityTrays * pricePerTrayPaisa
  const discountedPrice = computeDiscountedPricePaisa(
    quantityTrays,
    pricePerTrayPaisa,
    discountType,
    discountValue,
  )
  if (discountedPrice <= 0) return 0
  return lineTotal - quantityTrays * discountedPrice
}

export function effectiveItemPricePaisa(item: {
  price_per_tray_paisa: number
  discounted_price_paisa?: number
}): number {
  return (item.discounted_price_paisa ?? 0) > 0
    ? item.discounted_price_paisa!
    : item.price_per_tray_paisa
}

export function effectiveItemLineTotalPaisa(item: {
  quantity_trays?: number
  quantity_peti?: number
  quantity_tray?: number
  price_per_tray_paisa: number
  discounted_price_paisa?: number
}): number {
  const trays = item.quantity_trays
    ?? (item.quantity_peti ?? 0) * 12 + (item.quantity_tray ?? 0)
  if ((item.discounted_price_paisa ?? 0) > 0) {
    return item.discounted_price_paisa! * trays
  }
  return trays * item.price_per_tray_paisa
}

export function computeSaleSubtotalPaisa(
  items: Array<{
    quantity_trays: number
    price_per_tray_paisa: number
    discounted_price_paisa?: number
  }>,
): number {
  return items.reduce(
    (sum, item) => sum + effectiveItemLineTotalPaisa(item),
    0,
  )
}

export function computeDiscountAmountPaisa(
  subtotalPaisa: number,
  discountType: DiscountType | null,
  discountValue: number,
): number {
  if (!discountType || discountValue <= 0 || subtotalPaisa <= 0) return 0
  if (discountType === 'percentage') {
    return Math.min(
      subtotalPaisa,
      Math.round(subtotalPaisa * discountValue / 100),
    )
  }
  return Math.min(subtotalPaisa, Math.round(discountValue * 100))
}

export function computeSalePaymentBreakdown(sale: {
  payment_status: string
  amount_paid_paisa?: number
  total_paisa: number
}): { paid_paisa: number; remaining_paisa: number } {
  const total = sale.total_paisa
  let paid = 0
  if (sale.payment_status === 'paid') {
    paid = total
  } else if (sale.payment_status === 'partial') {
    paid = sale.amount_paid_paisa ?? 0
  }
  return {
    paid_paisa:      paid,
    remaining_paisa: total - paid,
  }
}
