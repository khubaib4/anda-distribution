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
