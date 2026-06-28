'use client'

import { X } from 'lucide-react'
import AccountForm from './account-form'
import type { BankAccountBalance } from '@/types'

interface Props {
  mode:     'create' | 'edit'
  account?: BankAccountBalance
  onSubmit: (values: {
    bank_name:      string
    account_holder: string
    account_number: string
    nickname:       string
  }) => Promise<void>
  onClose: () => void
}

export default function AccountModal({
  mode,
  account,
  onSubmit,
  onClose,
}: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="text-base font-semibold text-stone-900">
            {mode === 'create' ? 'Add account' : 'Edit account'}
          </h2>
          <button
            onClick={onClose}
            className="btn-ghost p-1.5 -mr-1.5"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <AccountForm
          initial={account}
          onSubmit={onSubmit}
          onCancel={onClose}
          submitLabel={mode === 'create' ? 'Add account' : 'Save changes'}
        />
      </div>
    </div>
  )
}
