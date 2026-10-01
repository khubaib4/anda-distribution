'use client'

import { useState, useEffect, use } from 'react'
import CustomerAccountActions from '@/components/customers/customer-account-actions'
import AllocationFields from '@/components/customers/allocation-fields'
import { useCustomerAccountRequest } from '@/hooks/use-customer-account-request'
import { moneyInputToPaisa, formatAccountPKR } from '@/lib/customer-account-money'
import { cache, createCacheScope } from '@/lib/cache'
import TenantLink from '@/components/tenant-link'
import {
  ArrowLeft,
  Phone,
  Plus,
  Download,
  TrendingUp,
  TrendingDown,
} from 'lucide-react'
import {
  formatPKR,
  formatDate,
  customerTypeLabel,
  todayString,
} from '@/lib/utils'
import {
  generateCustomerLedgerPDF,
  type LedgerData,
} from '@/lib/customer-ledger-pdf'
import { useTenant } from '@/lib/tenant-client'
import type { CustomerBalance, BankAccountBalance, Sale } from '@/types'
import { SkeletonList } from '@/components/ui/skeleton'
import { useTenantFetch } from '@/hooks/use-tenant-fetch'

function accountLabel(account: BankAccountBalance): string {
  if (account.nickname) return account.nickname
  return `${account.bank_name} — ${account.account_holder}`
}

export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const { logoUrl, userId, tenantId } = useTenant()
  const tenantFetch = useTenantFetch()

  const [customer,     setCustomer]     = useState<CustomerBalance | null>(null)
  const [ledgerData,   setLedgerData]   = useState<LedgerData | null>(null)
  const [loadingCust,  setLoadingCust]  = useState(true)
  const [loadingLedger,setLoadingLedger]= useState(true)
  const { withRequestId, resetRequest } = useCustomerAccountRequest()
  const [allocationMode, setAllocationMode] = useState<'old_first' | 'sale_only'>('old_first')
  const [selectedSaleId, setSelectedSaleId] = useState('')
  const [customerSales, setCustomerSales] = useState<Sale[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showPayForm,  setShowPayForm]  = useState(false)

  // Payment form state
  const [payAmount,    setPayAmount]    = useState('')
  const [payMethod,        setPayMethod]        = useState('cash')
  const [payBankAccountId, setPayBankAccountId] = useState('')
  const [bankAccounts,     setBankAccounts]     = useState<BankAccountBalance[]>([])
  const [payDate,      setPayDate]      = useState(todayString())
  const [payReference, setPayReference] = useState('')
  const [payNotes,     setPayNotes]     = useState('')
  const [paying,       setPaying]       = useState(false)
  const [payError,     setPayError]     = useState<string | null>(null)

  async function loadCustomer() {
    setLoadingCust(true)
    try {
      const res = await tenantFetch(`/api/customers/${id}`)
      if (!res.ok) throw new Error('Failed to load customer')
      const data = await res.json()
      setCustomer(data)
      if (data.accounts_enabled) await loadSales()
    } catch {
      setLoadError('Unable to load customer account. Please reload the page.')
    } finally {
      setLoadingCust(false)
    }
  }

  async function loadLedger() {
    setLoadingLedger(true)
    try {
      const res = await tenantFetch(`/api/customers/${id}/ledger`)
      if (!res.ok) throw new Error('Failed to load ledger')
      const data = await res.json()
      setLedgerData(data)
    } catch {
      setLoadError('Unable to load customer account. Please reload the page.')
    } finally {
      setLoadingLedger(false)
    }
  }

  useEffect(() => {
    loadCustomer()
    loadLedger()
  }, [id, tenantFetch])

  useEffect(() => {
    tenantFetch('/api/accounts')
      .then(r => {
        if (!r.ok) throw new Error('Failed to load accounts')
        return r.json()
      })
      .then((data: BankAccountBalance[]) =>
        setBankAccounts(data.filter(a => a.is_active))
      )
      .catch(console.error)
  }, [tenantFetch])

  async function loadSales() {
    const res = await tenantFetch(`/api/sales?customer_id=${id}`)
    if (!res.ok) {setLoadError('Unable to load customer invoices'); return}
    setCustomerSales((await res.json()).filter((sale: Sale) => (sale.remaining_paisa ?? 0) > 0))
  }

  async function refreshAccount() {
    const scope = createCacheScope(userId, tenantId)
    if (scope) cache.invalidatePattern(scope, '/api/')
    await Promise.all([loadCustomer(), loadLedger(), loadSales()])
  }

  async function handlePayment(e: React.FormEvent) {
    e.preventDefault()
    setPayError(null)

    const amountPaisa = moneyInputToPaisa(payAmount)
    if (amountPaisa === null || amountPaisa <= 0) {
      setPayError('Enter a valid amount')
      return
    }

    if (customer?.accounts_enabled && allocationMode === 'sale_only' && !selectedSaleId) {
      setPayError('Select an invoice'); return
    }
    setPaying(true)
    try {
      const payload = {
        customer_id: id, amount_paisa: amountPaisa, payment_date: payDate, payment_method: payMethod,
        reference: payReference || null, notes: payNotes || null,
        ...(payMethod === 'bank_transfer' && payBankAccountId ? {bank_account_id: payBankAccountId} : {}),
        ...(customer?.accounts_enabled ? {allocation_mode: allocationMode, ...(allocationMode === 'sale_only' ? {sale_id: selectedSaleId} : {})} : {}),
      }
      const res = await tenantFetch('/api/payments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customer?.accounts_enabled ? withRequestId(payload) : payload),
      })

      const data = await res.json()
      if (!res.ok) {
        setPayError(data.error ?? 'Failed to record payment')
        if (res.status === 409) await refreshAccount()
        setPaying(false)
        return
      }

      resetRequest()
      // Reset form
      setPayAmount('')
      setPayReference('')
      setPayNotes('')
      setPayBankAccountId('')
      setShowPayForm(false)

      // Reload
      await refreshAccount()
    } catch {
      setPayError(customer?.accounts_enabled ? 'Network error — retry with the same details to avoid a duplicate' : 'Network error — please try again')
    } finally {
      setPaying(false)
    }
  }

  const balance    = ledgerData?.summary.closing_balance ?? 0
  const accountMoney = customer?.accounts_enabled ? formatAccountPKR : formatPKR
  const isOverpaid = balance < 0

  return (
    <div className="max-w-2xl mx-auto">

      {/* Back */}
      <div className="mb-6">
        <TenantLink
          href="/customers"
          className="inline-flex items-center gap-1.5 text-sm text-stone-500
                     hover:text-stone-700 mb-3 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Customers
        </TenantLink>

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

            <div className="flex items-center gap-2 flex-shrink-0">
              {ledgerData && customer && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await tenantFetch(`/api/customers/${id}/ledger`)
                      if (!res.ok) throw new Error('Unable to refresh')
                      const fresh = await res.json()
                      setLedgerData(fresh)
                      await generateCustomerLedgerPDF(customer, fresh, logoUrl)
                    } catch { setLoadError('Unable to refresh the statement. Please try again.') }
                  }}
                  className="btn-secondary"
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">Download Statement</span>
                </button>
              )}
              <button
                onClick={() => setShowPayForm(v => !v)}
                className="btn-primary"
              >
                <Plus className="w-4 h-4" />
                Payment
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Balance summary cards */}
      {!loadingLedger && ledgerData && (
        <div className={`grid ${ledgerData.summary.accounts_enabled ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'} gap-3 mb-6`}>
          <div className="stat-card">
            <p className="stat-label">Total sales</p>
            <p className="stat-value text-base">
              {(ledgerData.summary.accounts_enabled ? formatAccountPKR : formatPKR)(ledgerData.summary.total_sales_paisa ?? ledgerData.summary.total_debit_paisa)}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">{ledgerData.summary.accounts_enabled ? 'Total received' : 'Total paid'}</p>
            <p className="stat-value text-base text-success">
              {(ledgerData.summary.accounts_enabled ? formatAccountPKR : formatPKR)(ledgerData.summary.total_paid_paisa ?? ledgerData.summary.total_credit_paisa)}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">
              {ledgerData.summary.accounts_enabled ? 'Balance due' : isOverpaid ? 'Advance' : 'Balance due'}
            </p>
            <p className={`stat-value text-base ${
              isOverpaid && !ledgerData.summary.accounts_enabled
                ? 'text-success'
                : (ledgerData.summary.due_paisa ?? balance) > 0
                  ? 'text-danger'
                  : 'text-stone-900'
            }`}>
              {(ledgerData.summary.accounts_enabled ? formatAccountPKR : formatPKR)(ledgerData.summary.due_paisa ?? Math.abs(balance))}
            </p>
          </div>
          {ledgerData.summary.accounts_enabled && <div className="stat-card"><p className="stat-label">Available advance</p><p className="stat-value text-base text-success">{(ledgerData.summary.accounts_enabled ? formatAccountPKR : formatPKR)(ledgerData.summary.advance_paisa ?? 0)}</p></div>}
        </div>
      )}

      {loadError && <p role="alert" className="text-sm text-danger mb-4">{loadError}</p>}
      {customer?.accounts_enabled && ledgerData && <CustomerAccountActions customerId={id}
        opening={ledgerData.summary.opening_balance ?? null} due={ledgerData.summary.due_paisa ?? 0}
        advance={ledgerData.summary.advance_paisa ?? 0} sales={customerSales} onSaved={refreshAccount} />}

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

            {customer?.accounts_enabled && <AllocationFields mode={allocationMode} onModeChange={setAllocationMode}
              sales={customerSales} saleId={selectedSaleId} onSaleChange={setSelectedSaleId} />}
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
                  max={todayString()}
                  onChange={e => setPayDate(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="label">Payment method</label>
              <select
                className="select"
                value={payMethod}
                onChange={e => {
                  setPayMethod(e.target.value)
                  if (e.target.value !== 'bank_transfer') {
                    setPayBankAccountId('')
                  }
                }}
              >
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="easypaisa">Easypaisa</option>
                <option value="jazzcash">JazzCash</option>
              </select>
            </div>

            {payMethod === 'bank_transfer' && (
              <div className="form-group">
                <label className="label">Bank account</label>
                <select
                  className="select"
                  value={payBankAccountId}
                  onChange={e => setPayBankAccountId(e.target.value)}
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

        {loadingLedger && <SkeletonList count={5} />}

        {!loadingLedger && ledgerData?.ledger.length === 0 && (
          <div className="card p-8 text-center">
            <p className="text-stone-400 text-sm">
              No transactions yet for this customer
            </p>
            <TenantLink
              href="/sales/new"
              className="btn-primary mt-4 inline-flex"
            >
              <Plus className="w-4 h-4" />
              Record a sale
            </TenantLink>
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
                    <th className="text-right">{customer?.accounts_enabled ? 'Net balance' : 'Balance'}</th>
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
                              {entry.details?.amount_paisa ? ` — ${accountMoney(entry.details.amount_paisa)}` : ''}
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
                            {accountMoney(entry.debit_paisa)}
                          </span>
                        ) : (
                          <span className="text-stone-300">—</span>
                        )}
                      </td>
                      <td className="text-right">
                        {entry.credit_paisa > 0 ? (
                          <span className="amount text-sm text-success">
                            {accountMoney(entry.credit_paisa)}
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
                          {customer?.accounts_enabled && entry.running_balance !== 0 ? (entry.running_balance > 0 ? 'Net due ' : 'Net credit ') : ''}
                          {entry.running_balance === 0
                            ? '—'
                            : accountMoney(Math.abs(entry.running_balance))
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
                        {customer?.accounts_enabled ? 'Net balance' : 'Closing balance'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="amount text-sm font-semibold text-danger">
                        {accountMoney(
                          ledgerData?.summary.total_debit_paisa ?? 0
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="amount text-sm font-semibold text-success">
                        {accountMoney(
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
                          : accountMoney(Math.abs(balance))
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
                        <p className="text-sm font-medium text-stone-900 break-words">
                          {entry.description}
                        </p>
                        <p className="text-xs text-stone-400 mt-0.5">
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
                          +{accountMoney(entry.debit_paisa)}
                        </p>
                      )}
                      {entry.credit_paisa > 0 && (
                        <p className="amount text-sm font-medium text-success">
                          -{accountMoney(entry.credit_paisa)}
                        </p>
                      )}
                      <p className={`amount text-xs mt-0.5 ${
                        entry.running_balance > 0
                          ? 'text-danger'
                          : 'text-success'
                      }`}>
                        {customer?.accounts_enabled ? (entry.running_balance < 0 ? 'Net credit: ' : 'Net due: ') : 'Bal: '}{accountMoney(Math.abs(entry.running_balance))}
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
                    {customer?.accounts_enabled ? 'Net balance' : 'Closing balance'}
                  </span>
                  <span className={`amount text-base font-bold ${
                    balance > 0
                      ? 'text-danger'
                      : balance < 0
                        ? 'text-success'
                        : 'text-stone-600'
                  }`}>
                    {balance === 0 ? 'Settled' : accountMoney(Math.abs(balance))}
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
