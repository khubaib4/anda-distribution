'use client'

import { useState, useEffect } from 'react'
import { useTenantRouter } from '@/hooks/use-tenant-router'
import { X, Download, Pencil } from 'lucide-react'
import TenantLink from '@/components/tenant-link'
import {
  formatPKR,
  formatDate,
  formatQty,
  paymentStatusClass,
  paymentStatusLabel,
  computeSaleSubtotalPaisa,
  computeSaleTotalPaisa,
  computeSalePaymentBreakdown,
  effectiveItemLineTotalPaisa,
  effectiveItemPricePaisa,
} from '@/lib/utils'
import { generateInvoicePDF } from '@/components/sales/invoice-pdf'
import { useTenant } from '@/lib/tenant-client'
import type { Sale } from '@/types'
import { useTenantFetch } from '@/hooks/use-tenant-fetch'

interface Props {
  saleId:    string
  onClose:   () => void
  onUpdated: () => void
}

export default function SaleDetailModal({
  saleId,
  onClose,
}: Props) {
  const router = useTenantRouter()
  const { logoUrl } = useTenant()
  const tenantFetch = useTenantFetch()
  const [sale,    setSale]    = useState<Sale & {
    cogs_paisa?: number
    subtotal_paisa?: number
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    tenantFetch(`/api/sales/${saleId}`)
      .then(r => {
        if (!r.ok) throw new Error('Failed to load sale')
        return r.json()
      })
      .then(data => {
        setSale(data)
      })
      .catch(() => setError('Failed to load sale'))
      .finally(() => setLoading(false))
  }, [saleId, tenantFetch])

  const subtotalPaisa = computeSaleSubtotalPaisa(sale?.items ?? [])
  const totalPaisa = computeSaleTotalPaisa(sale ?? { items: [] })
  const discountPaisa = subtotalPaisa - totalPaisa
  const { paid_paisa: paidPaisa, remaining_paisa: remainingPaisa } =
    computeSalePaymentBreakdown({
      payment_status: sale?.payment_status ?? 'unpaid',
      amount_paid_paisa: sale?.amount_paid_paisa,
      total_paisa: totalPaisa,
    })
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
          <div className="flex items-center gap-1">
            <button
              onClick={() => router.push(`/sales/${saleId}/edit`)}
              className="btn-ghost p-1.5 text-xs flex items-center gap-1"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Edit sale</span>
            </button>
            <button onClick={onClose} className="btn-ghost p-1.5 -mr-1.5">
              <X className="w-4 h-4" />
            </button>
          </div>
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
                  <TenantLink
                    href={`/customers/${sale.customer_id}`}
                    onClick={onClose}
                    className="text-sm font-medium text-brand-600
                               hover:text-brand-700"
                  >
                    {sale.customer?.contact_name ?? '—'}
                  </TenantLink>
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
                    const total = effectiveItemLineTotalPaisa(item)
                    const hasDiscount =
                      item.discount_type === 'percentage' || item.discount_type === 'fixed'
                    const hasSaving = total < item.quantity_trays * item.price_per_tray_paisa
                    const roundedUnitPrice = effectivePrice * item.quantity_trays !== total
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
                                {hasSaving && (
                                  <>
                                    <span className="line-through text-stone-400">
                                      {formatPKR(item.price_per_tray_paisa)}
                                    </span>
                                    {' '}
                                  </>
                                )}
                                {roundedUnitPrice && '≈ '}
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
                      {formatPKR(remainingPaisa)}
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
                <p className="section-title mb-3">Payment</p>
                <span className={paymentStatusClass(sale.payment_status)}>
                  {paymentStatusLabel(sale.payment_status)}
                </span>
                <p className="text-xs text-stone-500 leading-relaxed mt-2">
                  Record customer payments from the customer profile. Invoice
                  status updates automatically using FIFO.
                </p>
                <TenantLink
                  href={`/customers/${sale.customer_id}`}
                  onClick={onClose}
                  className="btn-secondary mt-3 inline-flex text-xs"
                >
                  Go to customer profile
                </TenantLink>
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
              onClick={() => {
                generateInvoicePDF(sale, logoUrl).catch(console.error)
              }}
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
