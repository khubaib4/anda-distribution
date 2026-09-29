import { clsx, type ClassValue } from 'clsx'
import { businessDateString } from './business-date'
import { wholeEggsFromWholeTrays } from './quantity'

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
    // A date-only value is a calendar day; localizing its UTC parse can
    // display the preceding day in browsers west of UTC.
    ...(/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? { timeZone: 'UTC' } : {}),
  })
}

// Format date short: "12 Jun"
export function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-PK', {
    day: 'numeric',
    month: 'short',
    ...(/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? { timeZone: 'UTC' } : {}),
  })
}

// Today as YYYY-MM-DD for date input default values
export function todayString(): string {
  return businessDateString()
}

export function petiPriceStringFromTrayPaisa(pricePerTrayPaisa: number): string {
  if (!pricePerTrayPaisa) return ''
  const rawPetiPrice = (pricePerTrayPaisa * 12) / 100
  return parseFloat(rawPetiPrice.toFixed(2)).toString()
}

// Generate invoice number
// PUR-20250612-482 or SAL-20250612-482
export function generateInvoiceNumber(prefix: 'PUR' | 'SAL'): string {
  const dateStr = businessDateString().replace(/-/g, '')
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

export type ValidatedSaleItem = {
  egg_category_id: string
  quantity_trays: number
  price_per_tray_paisa: number
  discount_type: DiscountType | null
  discount_value: number
  discounted_price_paisa: number
}

export function validateSaleItems(items: unknown):
  | { ok: true; items: ValidatedSaleItem[] }
  | { ok: false; error: string } {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'At least one item is required' }
  }

  const validated: ValidatedSaleItem[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        typeof item.egg_category_id !== 'string' || !item.egg_category_id ||
        wholeEggsFromWholeTrays(item.quantity_trays) === null ||
        typeof item.price_per_tray_paisa !== 'number' ||
        !Number.isSafeInteger(item.price_per_tray_paisa) ||
        item.price_per_tray_paisa <= 0 ||
        !Number.isSafeInteger(item.quantity_trays * item.price_per_tray_paisa)) {
      return { ok: false, error: 'Each item needs a category, a positive whole-tray quantity, and a positive safe-integer price in paisa' }
    }

    const discountType = item.discount_type ?? null
    if (discountType !== null && discountType !== 'percentage' && discountType !== 'fixed') {
      return { ok: false, error: 'Invalid item discount type' }
    }

    const discountValue = discountType === null ? 0 : item.discount_value
    if (discountType !== null &&
        (typeof discountValue !== 'number' || !Number.isFinite(discountValue) ||
         discountValue < 0 || (discountType === 'percentage' && discountValue > 100))) {
      return { ok: false, error: 'Invalid item discount value' }
    }

    const discountedPrice = computeDiscountedPricePaisa(
      item.quantity_trays,
      item.price_per_tray_paisa,
      discountType,
      discountValue,
    )
    const lineTotal = computeDiscountedLineTotalPaisa(
      item.quantity_trays,
      item.price_per_tray_paisa,
      discountType,
      discountValue,
    )
    if (!Number.isSafeInteger(discountedPrice) ||
        !Number.isSafeInteger(lineTotal)) {
      return { ok: false, error: 'Item discount exceeds the supported paisa range' }
    }

    validated.push({
      egg_category_id: item.egg_category_id,
      quantity_trays: item.quantity_trays,
      price_per_tray_paisa: item.price_per_tray_paisa,
      discount_type: discountType,
      discount_value: discountValue,
      discounted_price_paisa: discountedPrice,
    })
  }

  return { ok: true, items: validated }
}

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

  // Rounded unit price is for storage/display; line totals use the exact line helper.
  return Math.round(computeDiscountedLineTotalPaisa(
    quantityTrays,
    pricePerTrayPaisa,
    discountType,
    discountValue,
  ) / quantityTrays)
}

export function computeDiscountedLineTotalPaisa(
  quantityTrays: number,
  pricePerTrayPaisa: number,
  discountType: DiscountType | null,
  discountValue: number,
): number {
  const originalLinePaisa = quantityTrays * pricePerTrayPaisa
  if (!discountType || !Number.isFinite(discountValue) || discountValue <= 0 ||
      (discountType === 'percentage' && discountValue > 100)) {
    return originalLinePaisa
  }

  let discountPaisa: number
  if (discountType === 'percentage') {
    discountPaisa = Math.round(originalLinePaisa * discountValue / 100)
  } else {
    discountPaisa = Math.round(
      discountValue * 100 * quantityTrays / 12,
    )
  }

  return Math.max(0, originalLinePaisa - discountPaisa)
}

export function computeLineDiscountSavingPaisa(
  quantityTrays: number,
  pricePerTrayPaisa: number,
  discountType: DiscountType | null,
  discountValue: number,
): number {
  if (!discountType || discountValue <= 0 || quantityTrays <= 0) return 0
  const lineTotal = quantityTrays * pricePerTrayPaisa
  const discountedLineTotal = computeDiscountedLineTotalPaisa(
    quantityTrays,
    pricePerTrayPaisa,
    discountType,
    discountValue,
  )
  return lineTotal - discountedLineTotal
}

export function effectiveItemPricePaisa(item: {
  price_per_tray_paisa: number
  discount_type?: DiscountType | null
  discount_value?: number | null
  quantity_trays?: number
  quantity_peti?: number
  quantity_tray?: number
  discounted_price_paisa?: number | null
}): number {
  if (item.discount_type === 'percentage' || item.discount_type === 'fixed') {
    if (typeof item.discount_value === 'number' &&
        Number.isFinite(item.discount_value) && item.discount_value > 0 &&
        (item.discount_type !== 'percentage' || item.discount_value <= 100)) {
      const trays = item.quantity_trays
        ?? (item.quantity_peti ?? 0) * 12 + (item.quantity_tray ?? 0)
      return computeDiscountedPricePaisa(
        trays,
        item.price_per_tray_paisa,
        item.discount_type,
        item.discount_value,
      )
    }
    return item.price_per_tray_paisa
  }
  if (item.discount_type === null) return item.price_per_tray_paisa

  const discounted = item.discounted_price_paisa ?? 0
  if (discounted > 0 && discounted !== item.price_per_tray_paisa) {
    return discounted
  }
  return item.price_per_tray_paisa
}

export function effectiveItemLineTotalPaisa(item: {
  quantity_trays?: number
  quantity_peti?: number
  quantity_tray?: number
  price_per_tray_paisa: number
  discount_type?: DiscountType | null
  discount_value?: number | null
  discounted_price_paisa?: number | null
}): number {
  const trays = item.quantity_trays
    ?? (item.quantity_peti ?? 0) * 12 + (item.quantity_tray ?? 0)
  if (item.discount_type === null) return trays * item.price_per_tray_paisa
  if (item.discount_type === 'percentage' || item.discount_type === 'fixed') {
    return computeDiscountedLineTotalPaisa(
      trays,
      item.price_per_tray_paisa,
      item.discount_type,
      item.discount_value ?? 0,
    )
  }
  // Older callers without discount metadata retain their stored-price fallback.
  return trays * effectiveItemPricePaisa(item)
}

export function computeSaleSubtotalPaisa(
  items: Array<{
    quantity_trays: number
    price_per_tray_paisa: number
    discount_type?: DiscountType | null
    discount_value?: number | null
    discounted_price_paisa?: number | null
  }>,
): number {
  return items.reduce(
    (sum, item) => sum + effectiveItemLineTotalPaisa(item),
    0,
  )
}

/** Discounted sale total — item discounts plus overall sale discount. */
export function computeSaleTotalPaisa(sale: {
  discount_amount_paisa?: number | null
  items?: Array<{
    quantity_trays: number
    price_per_tray_paisa: number
    discount_type?: DiscountType | null
    discount_value?: number | null
    discounted_price_paisa?: number | null
  }>
}): number {
  const subtotal = computeSaleSubtotalPaisa(sale.items ?? [])
  const effectiveDiscount = Math.min(
    Math.max(0, sale.discount_amount_paisa ?? 0),
    Math.max(0, subtotal),
  )
  return Math.max(0, subtotal - effectiveDiscount)
}

/** Customer balance sale total — same as computeSaleTotalPaisa. */
export const computeCustomerSaleDebitPaisa = computeSaleTotalPaisa

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

export function validateSaleDiscount(
  subtotalPaisa: number,
  discountType: unknown,
  discountValue: unknown,
):
  | { ok: true; discount_type: DiscountType | null; discount_value: number; discount_amount_paisa: number }
  | { ok: false; error: string } {
  if (!Number.isSafeInteger(subtotalPaisa) || subtotalPaisa < 0) {
    return { ok: false, error: 'Sale subtotal exceeds the supported paisa range' }
  }

  const type = discountType ?? null
  if (type !== null && type !== 'percentage' && type !== 'fixed') {
    return { ok: false, error: 'Invalid sale discount type' }
  }

  const value = type === null ? 0 : discountValue
  if (type !== null &&
      (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
       (type === 'percentage' && value > 100))) {
    return { ok: false, error: 'Invalid sale discount value' }
  }

  const amount = computeDiscountAmountPaisa(subtotalPaisa, type, value as number)
  if (!Number.isSafeInteger(amount) || amount > subtotalPaisa) {
    return { ok: false, error: 'Sale discount exceeds the supported paisa range' }
  }

  return {
    ok: true,
    discount_type: type,
    discount_value: value as number,
    discount_amount_paisa: amount,
  }
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
