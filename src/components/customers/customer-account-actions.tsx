'use client'
import { useState } from 'react'
import { useTenantFetch } from '@/hooks/use-tenant-fetch'
import { useCustomerAccountRequest } from '@/hooks/use-customer-account-request'
import AllocationFields from './allocation-fields'
import { moneyInputToPaisa, formatAccountPKR as formatPKR } from '@/lib/customer-account-money'
import { todayString } from '@/lib/utils'
import type { CustomerOpeningBalance, Sale } from '@/types'

export default function CustomerAccountActions({ customerId, opening, advance, due, sales, onSaved }: {
  customerId: string; opening: CustomerOpeningBalance | null; advance: number; due: number; sales: Sale[]; onSaved: () => Promise<void>
}) {
  const tenantFetch = useTenantFetch()
  const { withRequestId, resetRequest } = useCustomerAccountRequest()
  const [form, setForm] = useState<'opening' | 'advance' | null>(null)
  const [type, setType] = useState<'due' | 'advance'>('due')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayString())
  const [notes, setNotes] = useState('')
  const [mode, setMode] = useState<'old_first' | 'sale_only'>('old_first')
  const [saleId, setSaleId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  function openForm(next: 'opening' | 'advance') {
    setForm(next); setError(null); resetRequest()
    setAmount(next === 'opening' && opening ? String(opening.amount_paisa / 100) : '')
    setType(opening?.balance_type ?? 'due'); setDate(opening?.entry_date ?? todayString()); setNotes(opening?.notes ?? '')
    setMode('old_first');setSaleId('')
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();setError(null)
    const paisa = moneyInputToPaisa(amount)
    const correcting = form === 'opening' && opening !== null
    if (amount.trim() === '' || paisa === null || (correcting ? paisa < 0 : paisa <= 0)) {
      setError(correcting ? 'Enter zero or a positive amount, with up to two decimal places' : 'Enter a positive amount, with up to two decimal places');return
    }
    if (form === 'advance' && (paisa > advance || paisa > (mode === 'old_first' ? due : sales.find(s => s.id === saleId)?.remaining_paisa ?? 0))) {
      setError('Choose an amount within the available advance and unpaid balance');return
    }
    setSaving(true)
    try {
      const payload = form === 'opening' ? {
        balance_type: type, amount_paisa: paisa, entry_date: date, notes: notes || null,
        ...(opening ? {expected_updated_at: opening.updated_at} : {}),
      } : {amount_paisa: paisa, allocation_mode: mode, ...(mode === 'sale_only' ? {sale_id: saleId} : {})}
      const res = await tenantFetch(`/api/customers/${customerId}/${form === 'opening' ? 'opening-balance' : 'apply-advance'}`, {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(withRequestId(payload)),
      })
      const data = await res.json()
      if (!res.ok) {setError(data.error ?? 'Unable to save');if(res.status===409)await onSaved();return}
      resetRequest();setForm(null);await onSaved()
    } catch {setError('Network error — retry with the same details to avoid a duplicate')}
    finally {setSaving(false)}
  }
  return <div className="mb-5 space-y-3">
    {opening && <div className="card p-3 text-sm"><strong>Previous {opening.balance_type}:</strong> {formatPKR(opening.amount_paisa)}{opening.notes && <p className="text-stone-500 mt-1">{opening.notes}</p>}</div>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-secondary" onClick={() => openForm('opening')}>{opening ? 'Correct previous balance' : 'Add previous balance'}</button>
      {advance>0 && due>0 && <button type="button" className="btn-secondary" onClick={() => openForm('advance')}>Apply advance</button>}
    </div>
    {form && <form className="card p-4 space-y-3" onSubmit={save}>
      <p className="section-title">{form==='opening' ? opening ? 'Correct previous balance' : 'Add previous balance' : 'Apply advance'}</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {form==='opening' && <>
        <p className="text-xs text-stone-500">Enter amounts from before using the app. This does not record a new sale or money received.</p>
        {opening && <p className="text-xs text-stone-500">A correction keeps the history. Enter zero to clear an incorrect previous balance. Reducing a settled amount can return payment to advance or reopen an invoice.</p>}
        <div className="form-group"><label className="label">Balance type</label><select className="select" value={type} onChange={e=>setType(e.target.value as 'due'|'advance')}><option value="due">Previous due</option><option value="advance">Previous advance</option></select></div>
      </>}
      <div className="form-group"><label className="label">Amount (Rs)</label><input type="number" min={form === 'opening' && opening ? '0' : '0.01'} step="0.01" className="input" value={amount} onChange={e=>setAmount(e.target.value)} required /></div>
      {form==='opening' ? <>
        <div className="form-group"><label className="label">Date</label><input type="date" className="input" max={todayString()} value={date} onChange={e=>setDate(e.target.value)} required /></div>
        <div className="form-group"><label className="label">Notes</label><input className="input" value={notes} onChange={e=>setNotes(e.target.value)} /></div>
      </> : <AllocationFields mode={mode} onModeChange={setMode} sales={sales} saleId={saleId} onSaleChange={setSaleId} />}
      <div className="flex gap-2"><button type="button" className="btn-secondary" disabled={saving} onClick={()=>setForm(null)}>Cancel</button><button className="btn-primary" disabled={saving}>{saving?'Saving…':'Save'}</button></div>
    </form>}
  </div>
}
