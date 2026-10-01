import { formatPdfPKR } from '@/lib/pdf-money'
import { formatBalanceAsOf } from '@/lib/customer-account-money'
import type { Sale } from '@/types'

export default function LatestCustomerBalance({ sale, rowClassName }: { sale: Sale; rowClassName?: string }) {
  const account = sale.account_summary
  if (!account?.accounts_enabled) return null
  return <div className="space-y-1">
    <p><strong>Latest customer balance</strong></p>
    <div className={rowClassName}><span>Other unpaid balances</span><span>{formatPdfPKR(Math.max(0, account.due_paisa - (sale.remaining_paisa ?? 0)))}</span></div>
    <div className={rowClassName}><strong>Total balance due</strong><strong>{formatPdfPKR(account.due_paisa)}</strong></div>
    <div className={rowClassName}><span>Available advance</span><span>{formatPdfPKR(account.advance_paisa)}</span></div>
    <p className="text-xs">Balance as of {formatBalanceAsOf(account.balance_as_of)}</p>
  </div>
}
