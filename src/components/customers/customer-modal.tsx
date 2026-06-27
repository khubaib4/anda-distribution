'use client'

import { X } from 'lucide-react'
import CustomerForm from './customer-form'
import type { CustomerBalance } from '@/types'

interface Props {
  mode:       'create' | 'edit'
  customer?:  CustomerBalance
  onSubmit:   (values: {
    contact_name:  string
    business_name: string
    phone:         string
    address:       string
    customer_type: string
    notes:         string
  }) => Promise<void>
  onClose:    () => void
}

export default function CustomerModal({
  mode,
  customer,
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
            {mode === 'create' ? 'Add customer' : 'Edit customer'}
          </h2>
          <button
            onClick={onClose}
            className="btn-ghost p-1.5 -mr-1.5"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <CustomerForm
          initial={customer}
          onSubmit={onSubmit}
          onCancel={onClose}
          submitLabel={mode === 'create' ? 'Add customer' : 'Save changes'}
        />
      </div>
    </div>
  )
}
