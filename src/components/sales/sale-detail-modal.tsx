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
  effectiveItemPricePaisa,
} from '@/lib/utils'
import { generateInvoicePDF } from '@/components/sales/invoice-pdf'
import type { BankAccountBalance, Sale } from '@/types'

function accountLabel(account: BankAccountBalance): string {
  if (account.nickname) return account.nickname
  return `${account.bank_name} — ${account.account_holder}`
}

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
    subtotal_paisa?: number
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const [editingPayment, setEditingPayment] = useState(false)
  const [paymentStatus,  setPaymentStatus]  = useState<
    'paid' | 'partial' | 'unpaid'
  >('unpaid')
  const [paymentMethod,  setPaymentMethod]  = useState('cash')
  const [bankAccountId,  setBankAccountId]  = useState('')
  const [bankAccounts,   setBankAccounts]   = useState<BankAccountBalance[]>([])

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

  useEffect(() => {
    if (!editingPayment) return
    window.fetch('/api/accounts')
      .then(r => r.json())
      .then((data: BankAccountBalance[]) =>
        setBankAccounts(data.filter(a => a.is_active))
      )
      .catch(console.error)
  }, [editingPayment])

  async function handleSavePayment() {
    setSaving(true)
    setError(null)

    const body: Record<string, unknown> = { payment_status: paymentStatus }
    if (paymentStatus === 'paid') {
      body.payment_method = paymentMethod
      if (paymentMethod === 'bank_transfer' && bankAccountId) {
        body.bank_account_id = bankAccountId
      }
    }

    const res = await window.fetch(`/api/sales/${saleId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })

    if (res.ok) {
      const updated = await res.json()
      setSale(prev => prev ? { ...prev, ...updated } : null)
      setEditingPayment(false)
      onUpdated()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Failed to update payment status')
    }
    setSaving(false)
  }

  const subtotalPaisa = sale?.subtotal_paisa ?? (sale?.items ?? []).reduce(
    (sum, item) => sum + item.quantity_trays * item.price_per_tray_paisa,
    0,
  )
  const discountPaisa = sale?.discount_amount_paisa ?? 0
  const totalPaisa = sale?.total_paisa ?? subtotalPaisa - discountPaisa
  const paidPaisa = sale?.paid_paisa ?? (
    sale?.payment_status === 'paid'
      ? totalPaisa
      : sale?.payment_status === 'partial'
        ? (sale?.amount_paid_paisa ?? 0)
        : 0
  )
  const remainingPaisa = sale?.remaining_paisa ?? (totalPaisa - paidPaisa)
  const grossProfit = totalPaisa - (sale?.cogs_paisa ?? 0)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
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

              <div>
                <p className="section-title">Items</p>
                <div className="space-y-2">
                  {(sale.items ?? []).map(item => {
                    const effectivePrice = effectiveItemPricePaisa(item)
                    const total = item.quantity_trays * effectivePrice
                    const hasDiscount = (item.discounted_price_paisa ?? 0) > 0
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between
                                   bg-stone-50 rounded px-3 py-2"
                      >
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-stone-900">
                              {item.egg_category?.name ?? '—'}
                            </p>
                            {hasDiscount && item.discount_type && (
                              <span className="badge badge-partial text-2xs">
                                {item.discount_type === 'percentage'
                                  ? `${item.discount_value}% off`
                                  : `₨${item.discount_value} off`}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-stone-500">
                            {formatQty(item.quantity_trays)} ×{' '}
                            {hasDiscount ? (
                              <>
                                <span className="line-through text-stone-400">
                                  {formatPKR(item.price_per_tray_paisa)}
                                </span>
                                {' '}
                                {formatPKR(effectivePrice)}/tray
                              </>
                            ) : (
                              <>{formatPKR(item.price_per_tray_paisa)}/tray</>
                            )}
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

              <div className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-stone-500">Subtotal</span>
                  <span className="amount text-stone-900">
                    {formatPKR(subtotalPaisa)}
                  </span>
                </div>
                {discountPaisa > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-success">Discount</span>
                    <span className="amount text-success">
                      − {formatPKR(discountPaisa)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-stone-500 font-medium">Total</span>
                  <span className="amount font-semibold text-stone-900">
                    {formatPKR(totalPaisa)}
                  </span>
                </div>

                {sale.payment_status === 'paid' && (
                  <div className="flex justify-between text-sm pt-1">
                    <span className="text-success font-medium">Paid ✓</span>
                    <span className="amount text-success font-medium">
                      {formatPKR(paidPaisa)}
                    </span>
                  </div>
                )}
                {sale.payment_status === 'partial' && (
                  <>
                    <div className="flex justify-between text-sm pt-1">
                      <span className="text-success font-medium">Paid</span>
                      <span className="amount text-success font-medium">
                        {formatPKR(paidPaisa)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-danger font-medium">Remaining</span>
                      <span className="amount text-danger font-medium">
                        {formatPKR(remainingPaisa)}
                      </span>
                    </div>
                  </>
                )}
                {sale.payment_status === 'unpaid' && (
                  <div className="flex justify-between text-sm pt-1">
                    <span className="text-danger font-medium">Unpaid</span>
                    <span className="amount text-danger font-medium">
                      {formatPKR(totalPaisa)}
                    </span>
                  </div>
                )}

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

                    {paymentStatus === 'paid' && (
                      <>
                        <div className="form-group">
                          <label className="label">Payment method</label>
                          <select
                            className="select"
                            value={paymentMethod}
                            onChange={e => {
                              setPaymentMethod(e.target.value)
                              if (e.target.value !== 'bank_transfer') {
                                setBankAccountId('')
                              }
                            }}
                          >
                            <option value="cash">Cash</option>
                            <option value="bank_transfer">Bank transfer</option>
                            <option value="easypaisa">Easypaisa</option>
                            <option value="jazzcash">JazzCash</option>
                          </select>
                        </div>

                        {paymentMethod === 'bank_transfer' && (
                          <div className="form-group">
                            <label className="label">Bank account</label>
                            <select
                              className="select"
                              value={bankAccountId}
                              onChange={e => setBankAccountId(e.target.value)}
                            >
                              <option value="">Select account…</option>
                              {bankAccounts.map(account => (
                                <option
                                  key={account.bank_account_id}
                                  value={account.bank_account_id}
                                >
                                  {accountLabel(account)}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </>
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
