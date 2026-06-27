'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, ChevronDown } from 'lucide-react'
import { usePurchases } from '@/hooks/use-purchases'
import { useSuppliers } from '@/hooks/use-suppliers'
import PurchaseDetailModal from '@/components/purchases/purchase-detail-modal'
import {
  formatPKR,
  formatDate,
  formatQty,
  paymentStatusClass,
  paymentStatusLabel,
} from '@/lib/utils'

export default function PurchasesPage() {
  // Filters
  const [status,     setStatus]     = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [from,       setFrom]       = useState('')
  const [to,         setTo]         = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // Detail modal
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { purchases, loading, error, refetch } = usePurchases({
    status:      status      || undefined,
    supplier_id: supplierId  || undefined,
    from:        from        || undefined,
    to:          to          || undefined,
  })

  const { suppliers } = useSuppliers()

  // Summary totals
  const totalValue   = purchases.reduce((s, p) => s + (p.total_paisa ?? 0), 0)
  const totalUnpaid  = purchases
    .filter(p => p.payment_status !== 'paid')
    .reduce((s, p) => s + ((p.total_paisa ?? 0) - p.amount_paid_paisa), 0)

  function clearFilters() {
    setStatus('')
    setSupplierId('')
    setFrom('')
    setTo('')
  }

  const hasFilters = status || supplierId || from || to

  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Purchases</h1>
          <p className="page-subtitle">
            {loading ? '…' : `${purchases.length} purchase${purchases.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Link href="/purchases/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New purchase</span>
          <span className="sm:hidden">New</span>
        </Link>
      </div>

      {/* Summary cards */}
      {!loading && purchases.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="stat-card">
            <p className="stat-label">Total value</p>
            <p className="stat-value text-xl">{formatPKR(totalValue)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Outstanding</p>
            <p className="stat-value text-xl text-danger">
              {formatPKR(totalUnpaid)}
            </p>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="mb-4">
        <button
          onClick={() => setShowFilters(v => !v)}
          className="btn-ghost text-sm flex items-center gap-1.5"
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`}
          />
          Filters
          {hasFilters && (
            <span className="ml-1 w-2 h-2 rounded-full bg-brand-500 inline-block" />
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
                <label className="label">Supplier</label>
                <select
                  className="select"
                  value={supplierId}
                  onChange={e => setSupplierId(e.target.value)}
                >
                  <option value="">All</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
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
          <p className="text-stone-400 text-sm">Loading purchases…</p>
        </div>
      )}

      {/* Empty */}
      {!loading && purchases.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <p className="text-stone-400 text-sm">
              {hasFilters
                ? 'No purchases match these filters'
                : 'No purchases yet — record your first one'}
            </p>
            {!hasFilters && (
              <Link href="/purchases/new" className="btn-primary mt-4">
                <Plus className="w-4 h-4" />
                New purchase
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Table — desktop */}
      {!loading && purchases.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="card hidden sm:block">
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Date</th>
                    <th>Supplier</th>
                    <th>Items</th>
                    <th className="text-right">Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map(p => {
                    const totalTrays = (p.items ?? []).reduce(
                      (s, i) => s + i.quantity_trays, 0
                    )
                    return (
                      <tr
                        key={p.id}
                        onClick={() => setSelectedId(p.id)}
                        className="cursor-pointer"
                      >
                        <td className="font-mono text-xs text-stone-500">
                          {p.invoice_number}
                        </td>
                        <td className="whitespace-nowrap">
                          {formatDate(p.purchase_date)}
                        </td>
                        <td className="font-medium text-stone-900">
                          {p.supplier_name_snapshot ?? p.supplier?.name ?? '—'}
                        </td>
                        <td className="text-stone-500 text-xs">
                          {(p.items ?? []).length} categor
                          {(p.items ?? []).length !== 1 ? 'ies' : 'y'} ·{' '}
                          {formatQty(totalTrays)}
                        </td>
                        <td className="text-right">
                          <span className="amount">
                            {formatPKR(p.total_paisa ?? 0)}
                          </span>
                        </td>
                        <td>
                          <span className={paymentStatusClass(p.payment_status)}>
                            {paymentStatusLabel(p.payment_status)}
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
            {purchases.map(p => {
              const totalTrays = (p.items ?? []).reduce(
                (s, i) => s + i.quantity_trays, 0
              )
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className="px-4 py-3.5 cursor-pointer active:bg-stone-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-stone-900 text-sm truncate">
                        {p.supplier_name_snapshot ?? p.supplier?.name ?? '—'}
                      </p>
                      <p className="text-xs text-stone-500 mt-0.5">
                        {formatDate(p.purchase_date)} ·{' '}
                        {formatQty(totalTrays)}
                      </p>
                      <p className="text-2xs text-stone-400 font-mono mt-0.5">
                        {p.invoice_number}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="amount text-sm text-stone-900">
                        {formatPKR(p.total_paisa ?? 0)}
                      </p>
                      <span className={`${paymentStatusClass(p.payment_status)} mt-1`}>
                        {paymentStatusLabel(p.payment_status)}
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
        <PurchaseDetailModal
          purchaseId={selectedId}
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
