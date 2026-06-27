'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatPKR, formatDate, todayString } from '@/lib/utils'

interface CashBookData {
  date: string
  cash_in: {
    sales: Array<{
      id:             string
      invoice_number: string | null
      customer_name:  string
      business_name:  string | null
      total_paisa:    number
    }>
    customer_payments: Array<{
      id:             string
      customer_id:    string
      customer_name:  string
      amount_paisa:   number
      payment_method: string | null
      reference:      string | null
      notes:          string | null
    }>
    total: number
  }
  cash_out: {
    expenses: Array<{
      id:           string
      description:  string
      category:     string
      icon:         string
      amount_paisa: number
    }>
    supplier_payments: Array<{
      id:             string
      supplier_id:    string
      supplier_name:  string
      amount_paisa:   number
      payment_method: string | null
      reference:      string | null
      notes:          string | null
    }>
    total: number
  }
  net: number
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function formatMethod(method: string | null): string | null {
  if (!method) return null
  return method.replace(/_/g, ' ')
}

export default function CashBookPage() {
  const [date,    setDate]    = useState(todayString())
  const [data,    setData]    = useState<CashBookData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.fetch(`/api/cash-book?date=${date}`)
      if (!res.ok) throw new Error('Failed to load cash book')
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { load() }, [load])

  const hasMovements = data && (
    data.cash_in.sales.length > 0 ||
    data.cash_in.customer_payments.length > 0 ||
    data.cash_out.expenses.length > 0 ||
    data.cash_out.supplier_payments.length > 0
  )

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Cash Book</h1>
          <p className="page-subtitle">Daily cash movements</p>
        </div>
      </div>

      {/* Date controls */}
      <div className="card p-4 mb-5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDate(d => shiftDate(d, -1))}
            className="btn-ghost p-2"
            aria-label="Previous day"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <input
            type="date"
            className="input flex-1"
            value={date}
            onChange={e => setDate(e.target.value)}
          />

          <button
            type="button"
            onClick={() => setDate(d => shiftDate(d, 1))}
            className="btn-ghost p-2"
            aria-label="Next day"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-stone-400 mt-2 text-center">
          {formatDate(date)}
        </p>
      </div>

      {error && (
        <div className="mb-4 text-sm text-danger bg-red-50 border
                        border-red-200 rounded px-4 py-3">
          {error}
        </div>
      )}

      {loading && (
        <div className="card p-8 text-center">
          <p className="text-stone-400 text-sm">Loading cash book…</p>
        </div>
      )}

      {!loading && data && !hasMovements && (
        <div className="card p-8 text-center">
          <p className="text-stone-400 text-sm">
            No cash movements for {formatDate(date)}
          </p>
        </div>
      )}

      {!loading && data && hasMovements && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">

            {/* Cash In */}
            <div>
              <p className="section-title text-success">Cash in</p>
              <div className="card divide-y divide-stone-100">
                {data.cash_in.sales.length === 0 &&
                 data.cash_in.customer_payments.length === 0 && (
                  <p className="px-4 py-6 text-sm text-stone-400 text-center">
                    No cash received
                  </p>
                )}

                {data.cash_in.sales.map(sale => (
                  <div
                    key={sale.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-900 truncate">
                        Sale — {sale.customer_name}
                      </p>
                      <p className="text-xs text-stone-400">
                        {sale.invoice_number ?? '—'} · Paid
                      </p>
                    </div>
                    <p className="amount text-sm font-medium text-success flex-shrink-0">
                      +{formatPKR(sale.total_paisa)}
                    </p>
                  </div>
                ))}

                {data.cash_in.customer_payments.map(payment => (
                  <div
                    key={payment.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-900 truncate">
                        Payment — {payment.customer_name}
                      </p>
                      <p className="text-xs text-stone-400 capitalize">
                        {formatMethod(payment.payment_method) ?? 'Received'}
                        {payment.reference && ` · ${payment.reference}`}
                      </p>
                    </div>
                    <p className="amount text-sm font-medium text-success flex-shrink-0">
                      +{formatPKR(payment.amount_paisa)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Cash Out */}
            <div>
              <p className="section-title text-danger">Cash out</p>
              <div className="card divide-y divide-stone-100">
                {data.cash_out.expenses.length === 0 &&
                 data.cash_out.supplier_payments.length === 0 && (
                  <p className="px-4 py-6 text-sm text-stone-400 text-center">
                    No cash paid out
                  </p>
                )}

                {data.cash_out.expenses.map(expense => (
                  <div
                    key={expense.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-900 truncate">
                        {expense.icon} {expense.description}
                      </p>
                      <p className="text-xs text-stone-400">
                        {expense.category}
                      </p>
                    </div>
                    <p className="amount text-sm font-medium text-danger flex-shrink-0">
                      -{formatPKR(expense.amount_paisa)}
                    </p>
                  </div>
                ))}

                {data.cash_out.supplier_payments.map(payment => (
                  <div
                    key={payment.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-900 truncate">
                        Supplier — {payment.supplier_name}
                      </p>
                      <p className="text-xs text-stone-400 capitalize">
                        {formatMethod(payment.payment_method) ?? 'Paid'}
                        {payment.notes && ` · ${payment.notes}`}
                      </p>
                    </div>
                    <p className="amount text-sm font-medium text-danger flex-shrink-0">
                      -{formatPKR(payment.amount_paisa)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Summary bar */}
          <div className="card p-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="stat-label">Total in</p>
                <p className="amount text-lg font-semibold text-success">
                  {formatPKR(data.cash_in.total)}
                </p>
              </div>
              <div>
                <p className="stat-label">Total out</p>
                <p className="amount text-lg font-semibold text-danger">
                  {formatPKR(data.cash_out.total)}
                </p>
              </div>
              <div>
                <p className="stat-label">Net cash</p>
                <p className={`amount text-lg font-bold ${
                  data.net >= 0 ? 'text-success' : 'text-danger'
                }`}>
                  {data.net >= 0 ? '+' : '-'}
                  {formatPKR(Math.abs(data.net))}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
