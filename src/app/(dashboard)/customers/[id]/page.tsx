'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Phone,
  Plus,
  TrendingUp,
  TrendingDown,
} from 'lucide-react'
import {
  formatPKR,
  formatDate,
  customerTypeLabel,
  todayString,
} from '@/lib/utils'
import type { CustomerBalance } from '@/types'

interface LedgerEntry {
  id:              string
  entry_type:      'sale' | 'payment'
  entry_date:      string
  description:     string
  debit_paisa:     number
  credit_paisa:    number
  running_balance: number
  invoice_number?: string
  payment_method?: string
}

interface LedgerData {
  ledger:  LedgerEntry[]
  summary: {
    total_debit_paisa:  number
    total_credit_paisa: number
    closing_balance:    number
  }
}

export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)

  const [customer,     setCustomer]     = useState<CustomerBalance | null>(null)
  const [ledgerData,   setLedgerData]   = useState<LedgerData | null>(null)
  const [loadingCust,  setLoadingCust]  = useState(true)
  const [loadingLedger,setLoadingLedger]= useState(true)
  const [showPayForm,  setShowPayForm]  = useState(false)

  // Payment form state
  const [payAmount,    setPayAmount]    = useState('')
  const [payMethod,    setPayMethod]    = useState('cash')
  const [payDate,      setPayDate]      = useState(todayString())
  const [payReference, setPayReference] = useState('')
  const [payNotes,     setPayNotes]     = useState('')
  const [paying,       setPaying]       = useState(false)
  const [payError,     setPayError]     = useState<string | null>(null)

  async function loadCustomer() {
    setLoadingCust(true)
    try {
      const res = await fetch(`/api/customers/${id}`)
      const data = await res.json()
      setCustomer(data)
    } catch {
      // ignore
    } finally {
      setLoadingCust(false)
    }
  }

  async function loadLedger() {
    setLoadingLedger(true)
    try {
      const res = await fetch(`/api/customers/${id}/ledger`)
      const data = await res.json()
      setLedgerData(data)
    } catch {
      // ignore
    } finally {
      setLoadingLedger(false)
    }
  }

  useEffect(() => {
    loadCustomer()
    loadLedger()
  }, [id])

  async function handlePayment(e: React.FormEvent) {
    e.preventDefault()
    setPayError(null)

    const amount = parseFloat(payAmount)
    if (!payAmount || isNaN(amount) || amount <= 0) {
      setPayError('Enter a valid amount')
      return
    }

    setPaying(true)
    try {
      const res = await fetch('/api/payments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id:    id,
          amount_paisa:   Math.round(amount * 100),
          payment_date:   payDate,
          payment_method: payMethod,
          reference:      payReference || null,
          notes:          payNotes     || null,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setPayError(data.error ?? 'Failed to record payment')
        setPaying(false)
        return
      }

      // Reset form
      setPayAmount('')
      setPayReference('')
      setPayNotes('')
      setShowPayForm(false)

      // Reload
      await Promise.all([loadCustomer(), loadLedger()])
    } catch {
      setPayError('Network error — please try again')
    } finally {
      setPaying(false)
    }
  }

  const balance    = ledgerData?.summary.closing_balance ?? 0
  const isOverpaid = balance < 0

  return (
    <div className="max-w-2xl mx-auto">

      {/* Back */}
      <div className="mb-6">
        <Link
          href="/customers"
          className="inline-flex items-center gap-1.5 text-sm text-stone-500
                     hover:text-stone-700 mb-3 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Customers
        </Link>

        {loadingCust ? (
          <div className="h-8 bg-stone-100 rounded w-48 animate-pulse" />
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="page-title">
                {customer?.contact_name ?? '—'}
              </h1>
              {customer?.business_name && (
                <p className="page-subtitle">{customer.business_name}</p>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                {customer?.phone && (
                  <span className="flex items-center gap-1.5 text-xs
                                   text-stone-500">
                    <Phone className="w-3 h-3" />
                    {customer.phone}
                  </span>
                )}
                {customer?.customer_type && (
                  <span className="badge badge-info">
                    {customerTypeLabel(customer.customer_type)}
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={() => setShowPayForm(v => !v)}
              className="btn-primary flex-shrink-0"
            >
              <Plus className="w-4 h-4" />
              Payment
            </button>
          </div>
        )}
      </div>

      {/* Balance summary cards */}
      {!loadingLedger && ledgerData && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="stat-card">
            <p className="stat-label">Total sales</p>
            <p className="stat-value text-base">
              {formatPKR(ledgerData.summary.total_debit_paisa)}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Total paid</p>
            <p className="stat-value text-base text-success">
              {formatPKR(ledgerData.summary.total_credit_paisa)}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">
              {isOverpaid ? 'Advance' : 'Balance due'}
            </p>
            <p className={`stat-value text-base ${
              isOverpaid
                ? 'text-success'
                : balance > 0
                  ? 'text-danger'
                  : 'text-stone-900'
            }`}>
              {formatPKR(Math.abs(balance))}
            </p>
          </div>
        </div>
      )}

      {/* Record payment form */}
      {showPayForm && (
        <div className="card p-4 mb-5">
          <p className="section-title mb-3">Record payment</p>
          <form onSubmit={handlePayment} noValidate className="space-y-3">

            {payError && (
              <div className="text-sm text-danger bg-red-50 border
                              border-red-200 rounded px-3 py-2">
                {payError}
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label className="label">
                  Amount (₨) <span className="text-danger">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input"
                  placeholder="0.00"
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="label">Date</label>
                <input
                  type="date"
                  className="input"
                  value={payDate}
                  onChange={e => setPayDate(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="label">Payment method</label>
              <select
                className="select"
                value={payMethod}
                onChange={e => setPayMethod(e.target.value)}
              >
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="easypaisa">Easypaisa</option>
                <option value="jazzcash">JazzCash</option>
              </select>
            </div>

            <div className="form-group">
              <label className="label">Reference / transaction ID</label>
              <input
                type="text"
                className="input"
                placeholder="Optional"
                value={payReference}
                onChange={e => setPayReference(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="label">Notes</label>
              <input
                type="text"
                className="input"
                placeholder="Optional"
                value={payNotes}
                onChange={e => setPayNotes(e.target.value)}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowPayForm(false)}
                className="btn-secondary flex-1"
                disabled={paying}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary flex-1"
                disabled={paying}
              >
                {paying ? 'Saving…' : 'Record payment'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Ledger */}
      <div>
        <p className="section-title mb-3">Account ledger</p>

        {loadingLedger && (
          <div className="card p-8 text-center">
            <p className="text-stone-400 text-sm">Loading ledger…</p>
          </div>
        )}

        {!loadingLedger && ledgerData?.ledger.length === 0 && (
          <div className="card p-8 text-center">
            <p className="text-stone-400 text-sm">
              No transactions yet for this customer
            </p>
            <Link
              href="/sales/new"
              className="btn-primary mt-4 inline-flex"
            >
              <Plus className="w-4 h-4" />
              Record a sale
            </Link>
          </div>
        )}

        {!loadingLedger && (ledgerData?.ledger.length ?? 0) > 0 && (
          <>
            {/* Desktop table */}
            <div className="card hidden sm:block overflow-hidden">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th className="text-right">Debit</th>
                    <th className="text-right">Credit</th>
                    <th className="text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerData?.ledger.map(entry => (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap text-stone-500 text-xs">
                        {formatDate(entry.entry_date)}
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          {entry.entry_type === 'sale' ? (
                            <TrendingUp className="w-3.5 h-3.5 text-danger
                                                   flex-shrink-0" />
                          ) : (
                            <TrendingDown className="w-3.5 h-3.5 text-success
                                                     flex-shrink-0" />
                          )}
                          <div>
                            <p className="text-sm text-stone-900">
                              {entry.description}
                            </p>
                            {entry.payment_method && (
                              <p className="text-2xs text-stone-400 capitalize">
                                {entry.payment_method.replace('_', ' ')}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="text-right">
                        {entry.debit_paisa > 0 ? (
                          <span className="amount text-sm text-danger">
                            {formatPKR(entry.debit_paisa)}
                          </span>
                        ) : (
                          <span className="text-stone-300">—</span>
                        )}
                      </td>
                      <td className="text-right">
                        {entry.credit_paisa > 0 ? (
                          <span className="amount text-sm text-success">
                            {formatPKR(entry.credit_paisa)}
                          </span>
                        ) : (
                          <span className="text-stone-300">—</span>
                        )}
                      </td>
                      <td className="text-right">
                        <span className={`amount text-sm font-medium ${
                          entry.running_balance > 0
                            ? 'text-danger'
                            : entry.running_balance < 0
                              ? 'text-success'
                              : 'text-stone-500'
                        }`}>
                          {entry.running_balance === 0
                            ? '—'
                            : formatPKR(Math.abs(entry.running_balance))
                          }
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>

                {/* Closing balance row */}
                <tfoot>
                  <tr className="bg-stone-50 border-t-2 border-stone-200">
                    <td colSpan={2} className="px-4 py-2.5">
                      <span className="text-xs font-semibold text-stone-600
                                       uppercase tracking-wider">
                        Closing balance
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="amount text-sm font-semibold text-danger">
                        {formatPKR(
                          ledgerData?.summary.total_debit_paisa ?? 0
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="amount text-sm font-semibold text-success">
                        {formatPKR(
                          ledgerData?.summary.total_credit_paisa ?? 0
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`amount text-sm font-bold ${
                        balance > 0
                          ? 'text-danger'
                          : balance < 0
                            ? 'text-success'
                            : 'text-stone-600'
                      }`}>
                        {balance === 0
                          ? 'Settled'
                          : formatPKR(Math.abs(balance))
                        }
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile timeline */}
            <div className="sm:hidden space-y-2">
              {ledgerData?.ledger.map(entry => (
                <div key={entry.id} className="card px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className={`w-7 h-7 rounded-full flex items-center
                                       justify-center flex-shrink-0 mt-0.5
                                       ${entry.entry_type === 'sale'
                                         ? 'bg-red-50'
                                         : 'bg-green-50'}`}>
                        {entry.entry_type === 'sale'
                          ? <TrendingUp className="w-3.5 h-3.5 text-danger" />
                          : <TrendingDown className="w-3.5 h-3.5 text-success" />
                        }
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-900
                                      truncate">
                          {entry.description}
                        </p>
                        <p className="text-xs text-stone-400">
                          {formatDate(entry.entry_date)}
                          {entry.payment_method && (
                            <span className="ml-1 capitalize">
                              · {entry.payment_method.replace('_', ' ')}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {entry.debit_paisa > 0 && (
                        <p className="amount text-sm font-medium text-danger">
                          +{formatPKR(entry.debit_paisa)}
                        </p>
                      )}
                      {entry.credit_paisa > 0 && (
                        <p className="amount text-sm font-medium text-success">
                          -{formatPKR(entry.credit_paisa)}
                        </p>
                      )}
                      <p className={`amount text-xs mt-0.5 ${
                        entry.running_balance > 0
                          ? 'text-danger'
                          : 'text-success'
                      }`}>
                        Bal: {formatPKR(Math.abs(entry.running_balance))}
                      </p>
                    </div>
                  </div>
                </div>
              ))}

              {/* Closing balance mobile */}
              <div className="card px-4 py-3 bg-stone-50 border-stone-300">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-stone-600
                                   uppercase tracking-wider">
                    Closing balance
                  </span>
                  <span className={`amount text-base font-bold ${
                    balance > 0
                      ? 'text-danger'
                      : balance < 0
                        ? 'text-success'
                        : 'text-stone-600'
                  }`}>
                    {balance === 0 ? 'Settled' : formatPKR(Math.abs(balance))}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
