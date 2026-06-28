'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Pencil, ChevronRight } from 'lucide-react'
import { useBankAccounts } from '@/hooks/use-bank-accounts'
import AccountModal from '@/components/accounts/account-modal'
import { formatPKR } from '@/lib/utils'
import type { BankAccountBalance } from '@/types'

type ModalState =
  | { open: false }
  | { open: true; mode: 'create' }
  | { open: true; mode: 'edit'; account: BankAccountBalance }

function accountLabel(account: BankAccountBalance): string {
  if (account.nickname) return account.nickname
  return `${account.bank_name} — ${account.account_holder}`
}

export default function AccountsPage() {
  const { accounts, loading, error, createAccount, updateAccount } =
    useBankAccounts()

  const [modal,        setModal]        = useState<ModalState>({ open: false })
  const [showInactive, setShowInactive] = useState(false)

  const filtered = showInactive
    ? accounts
    : accounts.filter(a => a.is_active)

  const totalBalance = accounts
    .filter(a => a.is_active)
    .reduce((sum, a) => sum + a.balance_paisa, 0)

  async function handleCreate(values: {
    bank_name: string
    account_holder: string
    account_number: string
    nickname: string
  }) {
    await createAccount(values)
    setModal({ open: false })
  }

  async function handleEdit(values: {
    bank_name: string
    account_holder: string
    account_number: string
    nickname: string
  }) {
    if (modal.open && modal.mode === 'edit') {
      await updateAccount(modal.account.bank_account_id, values)
      setModal({ open: false })
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Accounts</h1>
          <p className="page-subtitle">
            {accounts.filter(a => a.is_active).length} active account
            {accounts.filter(a => a.is_active).length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setModal({ open: true, mode: 'create' })}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          Add account
        </button>
      </div>

      {!loading && accounts.length > 0 && (
        <div className="stat-card mb-5">
          <p className="stat-label">Total balance across accounts</p>
          <p className={`stat-value text-xl ${
            totalBalance >= 0 ? 'text-success' : 'text-danger'
          }`}>
            {formatPKR(totalBalance)}
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 text-sm text-danger bg-red-50 border
                        border-red-200 rounded px-4 py-3">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setShowInactive(v => !v)}
          className={showInactive ? 'btn-secondary text-xs py-1' : 'btn-ghost text-xs py-1'}
        >
          {showInactive ? 'Showing all' : 'Show inactive'}
        </button>
      </div>

      {loading && (
        <div className="card p-8 text-center">
          <p className="text-stone-400 text-sm">Loading accounts…</p>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <p className="text-stone-400 text-sm">
              {showInactive
                ? 'No accounts found'
                : 'No active accounts — add your first one'}
            </p>
            <button
              onClick={() => setModal({ open: true, mode: 'create' })}
              className="btn-primary mt-4"
            >
              <Plus className="w-4 h-4" />
              Add account
            </button>
          </div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="card divide-y divide-stone-100">
          {filtered.map(account => (
            <div
              key={account.bank_account_id}
              className={`flex items-center gap-3 px-4 py-3.5
                ${!account.is_active ? 'opacity-50' : ''}`}
            >
              <div className="w-9 h-9 rounded-full bg-stone-100 flex
                              items-center justify-center flex-shrink-0">
                <span className="text-stone-600 font-semibold text-sm">
                  {account.bank_name.charAt(0).toUpperCase()}
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/accounts/${account.bank_account_id}`}
                    className="font-medium text-stone-900 text-sm
                               hover:text-brand-600 truncate transition-colors"
                  >
                    {accountLabel(account)}
                  </Link>
                  {!account.is_active && (
                    <span className="badge badge-unpaid flex-shrink-0">
                      Inactive
                    </span>
                  )}
                </div>
                <p className="text-xs text-stone-400 mt-0.5">
                  Received {formatPKR(account.total_received_paisa)}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="text-right">
                  <p className={`amount text-sm font-medium ${
                    account.balance_paisa >= 0 ? 'text-success' : 'text-danger'
                  }`}>
                    {formatPKR(account.balance_paisa)}
                  </p>
                  <p className="text-2xs text-stone-400">balance</p>
                </div>

                <button
                  onClick={() =>
                    setModal({ open: true, mode: 'edit', account })
                  }
                  className="btn-ghost p-1.5"
                  aria-label="Edit account"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>

                <Link
                  href={`/accounts/${account.bank_account_id}`}
                  className="btn-ghost p-1.5"
                  aria-label="View account"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal.open && modal.mode === 'create' && (
        <AccountModal
          mode="create"
          onSubmit={handleCreate}
          onClose={() => setModal({ open: false })}
        />
      )}
      {modal.open && modal.mode === 'edit' && (
        <AccountModal
          mode="edit"
          account={modal.account}
          onSubmit={handleEdit}
          onClose={() => setModal({ open: false })}
        />
      )}
    </div>
  )
}
