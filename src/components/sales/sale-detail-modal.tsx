'use client'

import { useState, useEffect } from 'react'
import { X, Download } from 'lucide-react'
import Link from 'next/link'
import {
  formatPKR,
  formatDate,
  formatQty,
  paymentStatusClass,
  paymentStatusLabel,
} from '@/lib/utils'
import { generateInvoicePDF } from '@/components/sales/invoice-pdf'
import type { Sale } from '@/types'

interface Props {
  saleId:    string
  onClose:   () => void
  onUpdated: () => void
}

export default function SaleDetailModal({
  saleId,
  onClose,
  onUpdated,
}: Props) {
  const [sale,    setSale]    = useState<Sale & {
    cogs_paisa?: number
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const [editingPayment, setEditingPayment] = useState(false)
  const [paymentStatus,  setPaymentStatus]  = useState<
    'paid' | 'partial' | 'unpaid'
  >('unpaid')

  useEffect(() => {
    window.fetch(`/api/sales/${saleId}`)
      .then(r => r.json())
      .then(data => {
        setSale(data)
        setPaymentStatus(data.payment_status)
      })
      .catch(() => setError('Failed to load sale'))
      .finally(() => setLoading(false))
  }, [saleId])

  async function handleSavePayment() {
    setSaving(true)
    setError(null)

    const res = await window.fetch(`/api/sales/${saleId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ payment_status: paymentStatus }),
    })

    if (res.ok) {
      const updated = await res.json()
      setSale(prev => prev ? { ...prev, ...updated } : null)
      setEditingPayment(false)
      onUpdated()
    } else {
      setError('Failed to update payment status')
    }
    setSaving(false)
  }

  const totalPaisa = sale?.total_paisa ?? 0
  const grossProfit = totalPaisa - (sale?.cogs_paisa ?? 0)

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
              Sale detail
            </h2>
            {sale && (
              <p className="text-xs text-stone-500 mt-0.5 font-mono">
                {sale.invoice_number}
              </p>
            )}
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 -mr-1.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {loading && (
            <p className="text-stone-400 text-sm text-center py-8">
              Loading…
            </p>
          )}

          {error && (
            <div className="text-sm text-danger bg-red-50 border
                            border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}

          {sale && !loading && (
            <>
              {/* Customer + date */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-2xs text-stone-400 uppercase
                                tracking-wider mb-0.5">
                    Customer
                  </p>
                  <Link
                    href={`/customers/${sale.customer_id}`}
                    onClick={onClose}
                    className="text-sm font-medium text-brand-600
                               hover:text-brand-700"
                  >
                    {sale.customer?.contact_name ?? '—'}
                  </Link>
                  {sale.customer?.business_name && (
                    <p className="text-xs text-stone-500">
                      {sale.customer.business_name}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-2xs text-stone-400 uppercase
                                tracking-wider mb-0.5">
                    Date
                  </p>
                  <p className="text-sm font-medium text-stone-900">
                    {formatDate(sale.sale_date)}
                  </p>
                </div>
              </div>

              <div className="divider" />

              {/* Items */}
              <div>
                <p className="section-title">Items</p>
                <div className="space-y-2">
                  {(sale.items ?? []).map(item => {
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
                {sale.cogs_paisa !== undefined && sale.cogs_paisa > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-stone-400">Gross profit</span>
                    <span className={`amount text-sm ${
                      grossProfit >= 0 ? 'text-success' : 'text-danger'
                    }`}>
                      {formatPKR(grossProfit)}
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
                  <span className={paymentStatusClass(sale.payment_status)}>
                    {paymentStatusLabel(sale.payment_status)}
                  </span>
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
              {sale.notes && (
                <>
                  <div className="divider" />
                  <div>
                    <p className="section-title">Notes</p>
                    <p className="text-sm text-stone-600">{sale.notes}</p>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {sale && !loading && (
          <div className="modal-footer flex-shrink-0 border-t border-stone-100">
            <button
              type="button"
              onClick={() => generateInvoicePDF(sale)}
              className="btn-secondary w-full"
            >
              <Download className="w-4 h-4" />
              Download Invoice
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
