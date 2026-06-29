'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, ChevronDown } from 'lucide-react'
import { useSales } from '@/hooks/use-sales'
import { useCustomers } from '@/hooks/use-customers'
import SaleDetailModal from '@/components/sales/sale-detail-modal'
import {
  formatPKR,
  formatDate,
  formatQty,
  paymentStatusClass,
  paymentStatusLabel,
} from '@/lib/utils'

export default function SalesPage() {
  const [status,      setStatus]      = useState('')
  const [customerId,  setCustomerId]  = useState('')
  const [from,        setFrom]        = useState('')
  const [to,          setTo]          = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [selectedId,  setSelectedId]  = useState<string | null>(null)

  const { sales, loading, error, refetch } = useSales({
    status:      status     || undefined,
    customer_id: customerId || undefined,
    from:        from       || undefined,
    to:          to         || undefined,
  })

  const { customers } = useCustomers()

  // Summary
  const totalRevenue = sales.reduce(
    (s, sale) => s + (sale.total_paisa ?? 0), 0
  )
  const totalUnpaid = sales
    .filter(s => s.payment_status !== 'paid')
    .reduce((s, sale) => s + (sale.remaining_paisa ?? sale.total_paisa ?? 0), 0)

  const hasFilters = status || customerId || from || to

  function clearFilters() {
    setStatus('')
    setCustomerId('')
    setFrom('')
    setTo('')
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Sales</h1>
          <p className="page-subtitle">
            {loading
              ? '…'
              : `${sales.length} sale${sales.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Link href="/sales/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New sale</span>
          <span className="sm:hidden">New</span>
        </Link>
      </div>

      {/* Summary cards */}
      {!loading && sales.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="stat-card">
            <p className="stat-label">Total revenue</p>
            <p className="stat-value text-xl">{formatPKR(totalRevenue)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Unpaid</p>
            <p className="stat-value text-xl text-danger">
              {formatPKR(totalUnpaid)}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4">
        <button
          onClick={() => setShowFilters(v => !v)}
          className="btn-ghost text-sm flex items-center gap-1.5"
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform
              ${showFilters ? 'rotate-180' : ''}`}
          />
          Filters
          {hasFilters && (
            <span className="ml-1 w-2 h-2 rounded-full bg-brand-500
                             inline-block" />
          )}
        </button>

        {showFilters && (
          <div className="mt-3 p-4 card space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="form-group">
                <label className="label">Status</label>
                <select
                  className="select"
                  value={status}
                  onChange={e => setStatus(e.target.value)}
                >
                  <option value="">All</option>
                  <option value="paid">Paid</option>
                  <option value="partial">Partial</option>
                  <option value="unpaid">Unpaid</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">Customer</label>
                <select
                  className="select"
                  value={customerId}
                  onChange={e => setCustomerId(e.target.value)}
                >
                  <option value="">All</option>
                  {customers.map(c => (
                    <option key={c.customer_id} value={c.customer_id}>
                      {c.contact_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="form-group">
                <label className="label">From date</label>
                <input
                  type="date"
                  className="input"
                  value={from}
                  onChange={e => setFrom(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="label">To date</label>
                <input
                  type="date"
                  className="input"
                  value={to}
                  onChange={e => setTo(e.target.value)}
                />
              </div>
            </div>

            {hasFilters && (
              <button onClick={clearFilters} className="btn-ghost text-xs">
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 text-sm text-danger bg-red-50 border
                        border-red-200 rounded px-4 py-3">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="card p-8 text-center">
          <p className="text-stone-400 text-sm">Loading sales…</p>
        </div>
      )}

      {/* Empty */}
      {!loading && sales.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <p className="text-stone-400 text-sm">
              {hasFilters
                ? 'No sales match these filters'
                : 'No sales yet — record your first one'}
            </p>
            {!hasFilters && (
              <Link href="/sales/new" className="btn-primary mt-4">
                <Plus className="w-4 h-4" />
                New sale
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Desktop table */}
      {!loading && sales.length > 0 && (
        <>
          <div className="card hidden sm:block">
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Items</th>
                    <th className="text-right">Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map(sale => {
                    const totalTrays = (sale.items ?? []).reduce(
                      (s, i) => s + i.quantity_trays, 0
                    )
                    return (
                      <tr
                        key={sale.id}
                        onClick={() => setSelectedId(sale.id)}
                        className="cursor-pointer"
                      >
                        <td className="font-mono text-xs text-stone-500">
                          {sale.invoice_number}
                        </td>
                        <td className="whitespace-nowrap">
                          {formatDate(sale.sale_date)}
                        </td>
                        <td>
                          <p className="font-medium text-stone-900">
                            {sale.customer?.contact_name ?? '—'}
                          </p>
                          {sale.customer?.business_name && (
                            <p className="text-xs text-stone-400">
                              {sale.customer.business_name}
                            </p>
                          )}
                        </td>
                        <td className="text-stone-500 text-xs">
                          {(sale.items ?? []).length} categor
                          {(sale.items ?? []).length !== 1 ? 'ies' : 'y'} ·{' '}
                          {formatQty(totalTrays)}
                        </td>
                        <td className="text-right">
                          <span className="amount text-stone-900">
                            {formatPKR(sale.total_paisa ?? 0)}
                          </span>
                          {sale.payment_status === 'partial' && (
                            <div className="mt-0.5">
                              <p className="text-xs text-success">
                                Paid: {formatPKR(sale.paid_paisa ?? 0)}
                              </p>
                              <p className="text-xs text-danger">
                                Due: {formatPKR(sale.remaining_paisa ?? 0)}
                              </p>
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={paymentStatusClass(
                            sale.payment_status
                          )}>
                            {paymentStatusLabel(sale.payment_status)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden card divide-y divide-stone-100">
            {sales.map(sale => {
              const totalTrays = (sale.items ?? []).reduce(
                (s, i) => s + i.quantity_trays, 0
              )
              return (
                <div
                  key={sale.id}
                  onClick={() => setSelectedId(sale.id)}
                  className="px-4 py-3.5 cursor-pointer active:bg-stone-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-stone-900 text-sm">
                        {sale.customer?.contact_name ?? '—'}
                      </p>
                      <p className="text-xs text-stone-500 mt-0.5">
                        {formatDate(sale.sale_date)} ·{' '}
                        {formatQty(totalTrays)}
                      </p>
                      <p className="text-2xs text-stone-400 font-mono mt-0.5">
                        {sale.invoice_number}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="amount text-sm text-stone-900">
                        {formatPKR(sale.total_paisa ?? 0)}
                      </p>
                      {sale.payment_status === 'partial' && (
                        <div className="mt-0.5">
                          <p className="text-xs text-success">
                            Paid: {formatPKR(sale.paid_paisa ?? 0)}
                          </p>
                          <p className="text-xs text-danger">
                            Due: {formatPKR(sale.remaining_paisa ?? 0)}
                          </p>
                        </div>
                      )}
                      <span className={`${paymentStatusClass(
                        sale.payment_status
                      )} mt-1`}>
                        {paymentStatusLabel(sale.payment_status)}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Detail modal */}
      {selectedId && (
        <SaleDetailModal
          saleId={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={() => {
            refetch()
            setSelectedId(null)
          }}
        />
      )}
    </div>
  )
}
