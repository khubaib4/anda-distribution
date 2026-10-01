import type { CustomerAccountSummary } from '@/types'

export function formatAccountPKR(paisa: number): string {
  // A draft may contain an incomplete or out-of-range calculation. Keep the
  // form usable so validation can explain it; saved amounts remain integers.
  if (!Number.isFinite(paisa) || !Number.isInteger(paisa)) return '₨\u00a0—'
  const absolute = BigInt(Math.abs(paisa))
  const fraction = absolute % BigInt(100)
  return '₨\u00a0' + (paisa < 0 ? '-' : '') + (absolute / BigInt(100)).toLocaleString('en-IN')
    + (fraction === BigInt(0) ? '' : '.' + String(fraction).padStart(2, '0'))
}

export function moneyInputToPaisa(value: string): number | null {
  if (value === '') return 0
  if (!/^\d+(?:\.\d{0,2})?$/.test(value)) return null
  const [rupees, fraction = ''] = value.split('.')
  const result = BigInt(rupees) * BigInt(100) + BigInt(fraction.padEnd(2, '0'))
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null
}

export function previewCustomerBalance(account: Pick<CustomerAccountSummary, 'due_paisa' | 'advance_paisa'>,
  saleTotal: number, received: number, advanceUsed: number, mode: 'old_first' | 'sale_only') {
  const eligible = mode === 'sale_only' ? saleTotal : account.due_paisa + saleTotal
  const applied = Math.min(Math.max(0, received), Math.max(0, eligible - advanceUsed))
  return {
    due_paisa: account.due_paisa + saleTotal - advanceUsed - applied,
    advance_paisa: account.advance_paisa - advanceUsed + received - applied,
    max_advance_paisa: Math.min(account.advance_paisa, eligible),
  }
}

export function formatBalanceAsOf(timestamp: string): string {
  return new Intl.DateTimeFormat('en-PK', {
    timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(timestamp)) + ' PKT'
}
