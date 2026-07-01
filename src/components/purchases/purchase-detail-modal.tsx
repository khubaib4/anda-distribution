'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import {
  formatPKR,
  formatDate,
  formatQty,
  paymentStatusClass,
  paymentStatusLabel,
} from '@/lib/utils'
import type { Purchase } from '@/types'

interface Props {
  purchaseId: string
  onClose:    () => void
  onUpdated:  () => void
}

export default function PurchaseDetailModal({
  purchaseId,
  onClose,
  onUpdated,
}: Props) {
  const [purchase, setPurchase] = useState<Purchase | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  // Payment update state
  const [editingPayment,  setEditingPayment]  = useState(false)
  const [paymentStatus,   setPaymentStatus]   = useState<'paid'|'partial'|'unpaid'>('unpaid')
  const [amountPaidInput, setAmountPaidInput] = useState('')

  useEffect(() => {
    window.fetch(`/api/purchases/${purchaseId}`)
      .then(r => r.json())
      .then(data => {
        setPurchase(data)
        setPaymentStatus(data.payment_status)
        setAmountPaidInput(
          data.amount_paid_paisa ? String(data.amount_paid_paisa / 100) : ''
        )
      })
      .catch(() => setError('Failed to load purchase'))
      .finally(() => setLoading(false))
  }, [purchaseId])

  async function handleSavePayment() {
    if (!purchase) return
    setSaving(true)
    setError(null)

    const amount_paid_paisa =
      paymentStatus === 'paid'
        ? purchase.total_paisa ?? 0
        : Math.round(parseFloat(amountPaidInput || '0') * 100)

    const res = await window.fetch(`/api/purchases/${purchaseId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ payment_status: paymentStatus, amount_paid_paisa }),
    })

    if (res.ok) {
      const updated = await res.json()
      setPurchase(prev => prev ? { ...prev, ...updated } : null)
      setEditingPayment(false)
      onUpdated()
    } else {
      setError('Failed to update payment')
    }
    setSaving(false)
  }

  const totalPaisa    = purchase?.total_paisa ?? 0
  const paidPaisa     = purchase?.amount_paid_paisa ?? 0
  const balancePaisa  = totalPaisa - paidPaisa

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-stone-900">
              Purchase detail
            </h2>
            {purchase && (
              <p className="text-xs text-stone-500 mt-0.5 font-mono">
                {purchase.invoice_number}
              </p>
            )}
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 -mr-1.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {loading && (
            <p className="text-stone-400 text-sm text-center py-8">
              Loading…
            </p>
          )}

          {error && (
            <div className="text-sm text-danger bg-red-50 border border-red-200
                            rounded px-3 py-2">
              {error}
            </div>
          )}

          {purchase && !loading && (
            <>
              {/* Supplier + Date */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-2xs text-stone-400 uppercase tracking-wider mb-0.5">
                    Supplier
                  </p>
                  <p className="text-sm font-medium text-stone-900">
                    {purchase.supplier_name_snapshot ?? purchase.supplier?.name ?? '—'}
                  </p>
                  {purchase.supplier?.phone && (
                    <p className="text-xs text-stone-500">
                      {purchase.supplier.phone}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-2xs text-stone-400 uppercase tracking-wider mb-0.5">
                    Date
                  </p>
                  <p className="text-sm font-medium text-stone-900">
                    {formatDate(purchase.purchase_date)}
                  </p>
                </div>
              </div>

              <div className="divider" />

              {/* Items */}
              <div>
                <p className="section-title">Items</p>
                <div className="space-y-2">
                  {(purchase.items ?? []).map(item => {
                    const total = item.quantity_trays * item.price_per_tray_paisa
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between
                                   bg-stone-50 rounded px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-medium text-stone-900">
                            {item.egg_category?.name ?? '—'}
                          </p>
                          <p className="text-xs text-stone-500">
                            {formatQty(item.quantity_trays)} ×{' '}
                            {formatPKR(item.price_per_tray_paisa)}/tray
                          </p>
                        </div>
                        <p className="amount text-sm text-stone-900">
                          {formatPKR(total)}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="divider" />

              {/* Totals */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-stone-500">Total</span>
                  <span className="amount font-semibold text-stone-900">
                    {formatPKR(totalPaisa)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-stone-500">Paid</span>
                  <span className="amount text-success">
                    {formatPKR(paidPaisa)}
                  </span>
                </div>
                {balancePaisa > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-stone-500">Balance due</span>
                    <span className="amount text-danger">
                      {formatPKR(balancePaisa)}
                    </span>
                  </div>
                )}
              </div>

              <div className="divider" />

              {/* Payment status */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="section-title mb-0">Payment</p>
                  {!editingPayment && (
                    <button
                      onClick={() => setEditingPayment(true)}
                      className="btn-ghost text-xs py-1 px-2"
                    >
                      Update
                    </button>
                  )}
                </div>

                {!editingPayment ? (
                  <div className="space-y-2">
                    <span className={paymentStatusClass(purchase.payment_status)}>
                      {paymentStatusLabel(purchase.payment_status)}
                    </span>
                    {purchase.paid_by === 'partner' && purchase.paid_by_partner_name && (
                      <p className="text-sm text-brand-600">
                        Paid by {purchase.paid_by_partner_name}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="form-group">
                      <label className="label">Payment status</label>
                      <select
                        className="select"
                        value={paymentStatus}
                        onChange={e =>
                          setPaymentStatus(
                            e.target.value as 'paid' | 'partial' | 'unpaid'
                          )
                        }
                      >
                        <option value="unpaid">Unpaid</option>
                        <option value="partial">Partial</option>
                        <option value="paid">Paid</option>
                      </select>
                    </div>

                    {paymentStatus === 'partial' && (
                      <div className="form-group">
                        <label className="label">Amount paid (₨)</label>
                        <input
                          type="number"
                          min="0"
                          className="input"
                          value={amountPaidInput}
                          onChange={e => setAmountPaidInput(e.target.value)}
                        />
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditingPayment(false)}
                        className="btn-secondary flex-1"
                        disabled={saving}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSavePayment}
                        className="btn-primary flex-1"
                        disabled={saving}
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Notes */}
              {purchase.notes && (
                <>
                  <div className="divider" />
                  <div>
                    <p className="section-title">Notes</p>
                    <p className="text-sm text-stone-600">{purchase.notes}</p>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
