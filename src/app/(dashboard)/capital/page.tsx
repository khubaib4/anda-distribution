'use client'

import { useState } from 'react'
import { Plus, X, ArrowUpCircle, ArrowDownCircle } from 'lucide-react'
import { useCapital, usePartners } from '@/hooks/use-capital'
import {
  formatPKR,
  formatDate,
  todayString,
  toPaisa,
} from '@/lib/utils'
import { useTenant } from '@/lib/tenant-client'
import AccessDenied from '@/components/access-denied'

// Partner color mapping — consistent colors per partner
const partnerColors = [
  {
    bg:     'bg-brand-100',
    text:   'text-brand-700',
    border: 'border-brand-200',
    bar:    'bg-brand-500',
  },
  {
    bg:     'bg-blue-100',
    text:   'text-blue-700',
    border: 'border-blue-200',
    bar:    'bg-blue-500',
  },
]

export default function CapitalPage() {
  const { permissions } = useTenant()
  const { data, loading, error, createTransaction } = useCapital()
  const { partners } = usePartners()

  const [showForm,   setShowForm]   = useState(false)
  const [partnerId,  setPartnerId]  = useState('')
  const [txType,     setTxType]     = useState<'contribution' | 'withdrawal'>('contribution')
  const [amount,     setAmount]     = useState('')
  const [txDate,     setTxDate]     = useState(todayString())
  const [reference,  setReference]  = useState('')
  const [notes,      setNotes]      = useState('')
  const [saving,     setSaving]     = useState(false)
  const [formError,  setFormError]  = useState<string | null>(null)

  // Filter transactions
  const [filterPartner, setFilterPartner] = useState('')

  const filteredTx = (data?.transactions ?? []).filter(tx =>
    filterPartner ? tx.partner_id === filterPartner : true
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    if (!partnerId)  { setFormError('Please select a partner'); return }
    if (!amount)     { setFormError('Amount is required'); return }

    const amount_paisa = toPaisa(amount)
    if (amount_paisa <= 0) {
      setFormError('Amount must be greater than 0')
      return
    }

    setSaving(true)
    try {
      await createTransaction({
        partner_id:       partnerId,
        type:             txType,
        amount_paisa,
        transaction_date: txDate,
        reference:        reference || undefined,
        notes:            notes     || undefined,
      })

      // Reset form
      setAmount('')
      setReference('')
      setNotes('')
      setShowForm(false)
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Something went wrong'
      )
    } finally {
      setSaving(false)
    }
  }

  const totalCapital = data?.totalCapital ?? 0

  if (!permissions.canViewCapital) return <AccessDenied />

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Capital</h1>
          <p className="page-subtitle">Partner contributions & withdrawals</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Add transaction</span>
          <span className="sm:hidden">Add</span>
        </button>
      </div>

      {/* Add transaction form */}
      {showForm && (
        <div className="card p-4 mb-5">
          <div className="flex items-center justify-between mb-4">
            <p className="section-title mb-0">Record transaction</p>
            <button
              onClick={() => setShowForm(false)}
              className="btn-ghost p-1.5 -mr-1.5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">

            {formError && (
              <div className="text-sm text-danger bg-red-50 border
                              border-red-200 rounded px-3 py-2">
                {formError}
              </div>
            )}

            {/* Type toggle */}
            <div className="form-group">
              <label className="label">Transaction type</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTxType('contribution')}
                  className={[
                    'flex items-center justify-center gap-2 py-2.5 rounded-lg',
                    'border text-sm font-medium transition-colors',
                    txType === 'contribution'
                      ? 'border-success bg-green-50 text-success'
                      : 'border-stone-200 bg-white text-stone-500 hover:bg-stone-50',
                  ].join(' ')}
                >
                  <ArrowUpCircle className="w-4 h-4" />
                  Contribution
                </button>
                <button
                  type="button"
                  onClick={() => setTxType('withdrawal')}
                  className={[
                    'flex items-center justify-center gap-2 py-2.5 rounded-lg',
                    'border text-sm font-medium transition-colors',
                    txType === 'withdrawal'
                      ? 'border-danger bg-red-50 text-danger'
                      : 'border-stone-200 bg-white text-stone-500 hover:bg-stone-50',
                  ].join(' ')}
                >
                  <ArrowDownCircle className="w-4 h-4" />
                  Withdrawal
                </button>
              </div>
            </div>

            {/* Partner */}
            <div className="form-group">
              <label className="label">
                Partner <span className="text-danger">*</span>
              </label>
              <select
                className="select"
                value={partnerId}
                onChange={e => setPartnerId(e.target.value)}
              >
                <option value="">Select partner…</option>
                {partners.map(p => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
            </div>

            {/* Amount + Date */}
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
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="label">Date</label>
                <input
                  type="date"
                  className="input"
                  value={txDate}
                  onChange={e => setTxDate(e.target.value)}
                />
              </div>
            </div>

            {/* Reference */}
            <div className="form-group">
              <label className="label">
                Reference
                <span className="text-stone-400 font-normal ml-1">
                  (cheque no., bank transfer ID)
                </span>
              </label>
              <input
                type="text"
                className="input"
                placeholder="Optional"
                value={reference}
                onChange={e => setReference(e.target.value)}
              />
            </div>

            {/* Notes */}
            <div className="form-group">
              <label className="label">Notes</label>
              <input
                type="text"
                className="input"
                placeholder="Optional"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="btn-secondary flex-1"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={[
                  'flex-1 btn-primary',
                  txType === 'withdrawal' ? 'bg-red-600 hover:bg-red-700' : '',
                ].join(' ')}
                disabled={saving}
              >
                {saving
                  ? 'Saving…'
                  : txType === 'contribution'
                    ? 'Record contribution'
                    : 'Record withdrawal'
                }
              </button>
            </div>
          </form>
        </div>
      )}

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
          <p className="text-stone-400 text-sm">Loading capital data…</p>
        </div>
      )}

      {!loading && data && (
        <>
          {/* Total capital */}
          <div className="stat-card mb-5">
            <p className="stat-label">Total capital in business</p>
            <p className="stat-value">{formatPKR(totalCapital)}</p>
          </div>

          {/* Partner cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            {(data.summaries ?? []).map((partner, idx) => {
              const colors  = partnerColors[idx % partnerColors.length]
              const pct     = totalCapital > 0
                ? Math.round(
                    (partner.net_capital_paisa / totalCapital) * 100
                  )
                : 0

              return (
                <div key={partner.partner_id} className="card p-4">
                  {/* Partner header */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-10 h-10 rounded-full ${colors.bg}
                                    flex items-center justify-center
                                    flex-shrink-0`}>
                      <span className={`font-bold text-sm ${colors.text}`}>
                        {partner.full_name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="font-semibold text-stone-900 text-sm">
                        {partner.full_name}
                      </p>
                      <p className="text-xs text-stone-400">
                        {pct}% ownership
                      </p>
                    </div>
                  </div>

                  {/* Ownership bar */}
                  <div className="h-1.5 bg-stone-100 rounded-full
                                  overflow-hidden mb-4">
                    <div
                      className={`h-full ${colors.bar} rounded-full
                                  transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  {/* Stats */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-stone-500">Contributed</span>
                      <span className="amount text-success font-medium">
                        {formatPKR(partner.total_contributed_paisa)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-stone-500">Withdrawn</span>
                      <span className="amount text-danger font-medium">
                        {formatPKR(partner.total_withdrawn_paisa)}
                      </span>
                    </div>
                    <div className="divider" />
                    <div className="flex justify-between text-sm">
                      <span className="font-semibold text-stone-900">
                        Net capital
                      </span>
                      <span className="amount font-bold text-stone-900">
                        {formatPKR(partner.net_capital_paisa)}
                      </span>
                    </div>
                  </div>

                  {/* Quick add button */}
                  <button
                    onClick={() => {
                      setPartnerId(partner.partner_id)
                      setTxType('contribution')
                      setShowForm(true)
                      window.scrollTo({ top: 0, behavior: 'smooth' })
                    }}
                    className="btn-secondary w-full mt-4 text-xs py-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add transaction
                  </button>
                </div>
              )
            })}
          </div>

          {/* Transaction history */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="section-title mb-0">Transaction history</p>
              <select
                className="select text-xs py-1 w-36"
                value={filterPartner}
                onChange={e => setFilterPartner(e.target.value)}
              >
                <option value="">All partners</option>
                {partners.map(p => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
            </div>

            {filteredTx.length === 0 ? (
              <div className="card p-8 text-center">
                <p className="text-stone-400 text-sm">
                  No transactions yet
                </p>
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="card hidden sm:block">
                  <div className="table-container">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Partner</th>
                          <th>Type</th>
                          <th>Reference</th>
                          <th className="text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTx.map(tx => (
                          <tr key={tx.id}>
                            <td className="whitespace-nowrap text-stone-500
                                           text-xs">
                              {formatDate(tx.transaction_date)}
                            </td>
                            <td className="font-medium text-stone-900">
                              {tx.partner?.full_name ?? '—'}
                            </td>
                            <td>
                              <span className={[
                                'badge',
                                tx.type === 'contribution'
                                  ? 'badge-paid'
                                  : 'badge-unpaid',
                              ].join(' ')}>
                                {tx.type === 'contribution'
                                  ? '↑ Contribution'
                                  : '↓ Withdrawal'}
                              </span>
                            </td>
                            <td className="text-xs text-stone-400">
                              {tx.reference ?? '—'}
                            </td>
                            <td className="text-right">
                              <span className={`amount font-medium ${
                                tx.type === 'contribution'
                                  ? 'text-success'
                                  : 'text-danger'
                              }`}>
                                {tx.type === 'contribution' ? '+' : '-'}
                                {formatPKR(tx.amount_paisa)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile cards */}
                <div className="sm:hidden card divide-y divide-stone-100">
                  {filteredTx.map(tx => (
                    <div key={tx.id} className="px-4 py-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-7 h-7 rounded-full flex items-center
                                           justify-center flex-shrink-0 ${
                            tx.type === 'contribution'
                              ? 'bg-green-50'
                              : 'bg-red-50'
                          }`}>
                            {tx.type === 'contribution'
                              ? <ArrowUpCircle className="w-4 h-4 text-success" />
                              : <ArrowDownCircle className="w-4 h-4 text-danger" />
                            }
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-stone-900">
                              {tx.partner?.full_name ?? '—'}
                            </p>
                            <p className="text-xs text-stone-400">
                              {formatDate(tx.transaction_date)}
                              {tx.reference && ` · ${tx.reference}`}
                            </p>
                          </div>
                        </div>
                        <p className={`amount text-sm font-semibold
                                       flex-shrink-0 ${
                          tx.type === 'contribution'
                            ? 'text-success'
                            : 'text-danger'
                        }`}>
                          {tx.type === 'contribution' ? '+' : '-'}
                          {formatPKR(tx.amount_paisa)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
