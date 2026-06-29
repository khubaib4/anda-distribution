'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
} from 'lucide-react'
import { formatPKR, formatDate } from '@/lib/utils'
import type { BankAccountBalance } from '@/types'
import { useTenant } from '@/lib/tenant-client'
import AccessDenied from '@/components/access-denied'

interface StatementEntry {
  id:              string
  entry_type:      'customer_payment' | 'supplier_payment' | 'expense'
  entry_date:      string
  description:     string
  credit_paisa:    number
  debit_paisa:     number
  running_balance: number
  payment_method?: string
}

interface StatementData {
  entries: StatementEntry[]
  summary: {
    total_credit_paisa: number
    total_debit_paisa:  number
    closing_balance:    number
  }
}

function accountLabel(account: BankAccountBalance): string {
  if (account.nickname) return account.nickname
  return `${account.bank_name} — ${account.account_holder}`
}

export default function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { permissions } = useTenant()
  const { id } = use(params)

  const [account,         setAccount]         = useState<BankAccountBalance | null>(null)
  const [statementData,   setStatementData]   = useState<StatementData | null>(null)
  const [loadingAccount,  setLoadingAccount]  = useState(true)
  const [loadingStatement,setLoadingStatement]= useState(true)

  async function loadAccount() {
    setLoadingAccount(true)
    try {
      const res  = await window.fetch(`/api/accounts/${id}`)
      const data = await res.json()
      setAccount(data)
    } catch { /* ignore */ }
    finally { setLoadingAccount(false) }
  }

  async function loadStatement() {
    setLoadingStatement(true)
    try {
      const res  = await window.fetch(`/api/accounts/${id}/statement`)
      const data = await res.json()
      setStatementData(data)
    } catch { /* ignore */ }
    finally { setLoadingStatement(false) }
  }

  useEffect(() => {
    loadAccount()
    loadStatement()
  }, [id])

  const balance = statementData?.summary.closing_balance ?? 0

  if (!permissions.canViewAccounts) return <AccessDenied />

  return (
    <div className="max-w-2xl mx-auto">

      <div className="mb-6">
        <Link
          href="/accounts"
          className="inline-flex items-center gap-1.5 text-sm text-stone-500
                     hover:text-stone-700 mb-3 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Accounts
        </Link>

        {loadingAccount ? (
          <div className="h-8 bg-stone-100 rounded w-48 animate-pulse" />
        ) : (
          <div>
            <h1 className="page-title">
              {account ? accountLabel(account) : '—'}
            </h1>
            {account && (
              <p className="text-xs text-stone-500 mt-1">
                {account.bank_name}
                {account.account_number && ` · ${account.account_number}`}
              </p>
            )}
          </div>
        )}
      </div>

      {!loadingStatement && statementData && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="stat-card">
            <p className="stat-label">Total received</p>
            <p className="stat-value text-base text-success">
              {formatPKR(statementData.summary.total_credit_paisa)}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Total paid out</p>
            <p className="stat-value text-base text-danger">
              {formatPKR(statementData.summary.total_debit_paisa)}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Current balance</p>
            <p className={`stat-value text-base ${
              balance >= 0 ? 'text-success' : 'text-danger'
            }`}>
              {formatPKR(balance)}
            </p>
          </div>
        </div>
      )}

      <div>
        <p className="section-title mb-3">Account statement</p>

        {loadingStatement && (
          <div className="card p-8 text-center">
            <p className="text-stone-400 text-sm">Loading statement…</p>
          </div>
        )}

        {!loadingStatement && statementData?.entries.length === 0 && (
          <div className="card p-8 text-center">
            <p className="text-stone-400 text-sm">
              No transactions yet for this account
            </p>
          </div>
        )}

        {!loadingStatement && (statementData?.entries.length ?? 0) > 0 && (
          <>
            <div className="card hidden sm:block overflow-hidden">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th className="text-right">Credit</th>
                    <th className="text-right">Debit</th>
                    <th className="text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {statementData?.entries.map(entry => (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap text-stone-500 text-xs">
                        {formatDate(entry.entry_date)}
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          {entry.credit_paisa > 0 ? (
                            <TrendingDown className="w-3.5 h-3.5 text-success
                                                     flex-shrink-0" />
                          ) : (
                            <TrendingUp className="w-3.5 h-3.5 text-danger
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
                        {entry.credit_paisa > 0 ? (
                          <span className="amount text-sm text-success">
                            {formatPKR(entry.credit_paisa)}
                          </span>
                        ) : (
                          <span className="text-stone-300">—</span>
                        )}
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
                        <span className={`amount text-sm font-medium ${
                          entry.running_balance >= 0
                            ? 'text-success'
                            : 'text-danger'
                        }`}>
                          {formatPKR(entry.running_balance)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-stone-50 border-t-2 border-stone-200">
                    <td colSpan={2} className="px-4 py-2.5">
                      <span className="text-xs font-semibold text-stone-600
                                       uppercase tracking-wider">
                        Closing balance
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="amount text-sm font-semibold text-success">
                        {formatPKR(statementData?.summary.total_credit_paisa ?? 0)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="amount text-sm font-semibold text-danger">
                        {formatPKR(statementData?.summary.total_debit_paisa ?? 0)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`amount text-sm font-bold ${
                        balance >= 0 ? 'text-success' : 'text-danger'
                      }`}>
                        {formatPKR(balance)}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="sm:hidden space-y-2">
              {statementData?.entries.map(entry => (
                <div key={entry.id} className="card px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className={`w-7 h-7 rounded-full flex items-center
                                       justify-center flex-shrink-0 mt-0.5
                                       ${entry.credit_paisa > 0
                                         ? 'bg-green-50' : 'bg-red-50'}`}>
                        {entry.credit_paisa > 0
                          ? <TrendingDown className="w-3.5 h-3.5 text-success" />
                          : <TrendingUp   className="w-3.5 h-3.5 text-danger"  />
                        }
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-900 truncate">
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
                      {entry.credit_paisa > 0 && (
                        <p className="amount text-sm font-medium text-success">
                          +{formatPKR(entry.credit_paisa)}
                        </p>
                      )}
                      {entry.debit_paisa > 0 && (
                        <p className="amount text-sm font-medium text-danger">
                          -{formatPKR(entry.debit_paisa)}
                        </p>
                      )}
                      <p className={`amount text-xs mt-0.5 ${
                        entry.running_balance >= 0
                          ? 'text-success'
                          : 'text-danger'
                      }`}>
                        Bal: {formatPKR(entry.running_balance)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}

              <div className="card px-4 py-3 bg-stone-50 border-stone-300">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-stone-600
                                   uppercase tracking-wider">
                    Closing balance
                  </span>
                  <span className={`amount text-base font-bold ${
                    balance >= 0 ? 'text-success' : 'text-danger'
                  }`}>
                    {formatPKR(balance)}
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
