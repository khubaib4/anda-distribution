'use client'
import { formatAccountPKR as formatPKR } from '@/lib/customer-account-money'
import type { Sale } from '@/types'

export default function AllocationFields({ mode, onModeChange, saleId, onSaleChange, sales, advance, useAdvance, onUseAdvance,
  advanceAmount, onAdvanceAmount }: {
  mode: 'old_first' | 'sale_only'; onModeChange: (mode: 'old_first' | 'sale_only') => void
  saleId?: string; onSaleChange?: (id: string) => void; sales?: Sale[]
  advance?: number; useAdvance?: boolean; onUseAdvance?: (value: boolean) => void
  advanceAmount?: string; onAdvanceAmount?: (amount: string) => void
}) {
  return <div className="space-y-3">
    <div className="form-group">
      <label className="label">Payment applies to</label>
      <select className="select" value={mode} onChange={e => onModeChange(e.target.value as 'old_first' | 'sale_only')}>
        <option value="old_first">Old balance first</option>
        <option value="sale_only">{sales ? 'Selected sale only' : 'This sale only'}</option>
      </select>
      <p className="text-xs text-stone-500 mt-1">{mode === 'old_first'
        ? 'Settle previous due, then the oldest unpaid invoices. Any extra payment becomes advance.'
        : 'Other unpaid balances stay unchanged. Any extra payment becomes advance.'}</p>
    </div>
    {sales && mode === 'sale_only' && <div className="form-group">
      <label className="label">Select invoice</label>
      <select className="select" value={saleId ?? ''} onChange={e => onSaleChange?.(e.target.value)}>
        <option value="">Select invoice…</option>
        {sales.map(sale => <option key={sale.id} value={sale.id}>{sale.invoice_number} — Due {formatPKR(sale.remaining_paisa ?? 0)}</option>)}
      </select>
    </div>}
    {onUseAdvance && (advance ?? 0) > 0 && <>
      <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={useAdvance ?? false} onChange={e => onUseAdvance(e.target.checked)} />Use advance — available {formatPKR(advance ?? 0)}</label>
      {useAdvance && <div className="form-group"><label className="label">Advance to use (Rs)</label>
        <input type="number" min="0" step="0.01" className="input" value={advanceAmount ?? ''} onChange={e => onAdvanceAmount?.(e.target.value)} />
      </div>}
    </>}
  </div>
}
