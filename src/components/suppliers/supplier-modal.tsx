'use client'

import { X } from 'lucide-react'
import SupplierForm from './supplier-form'
import type { Supplier } from '@/types'

interface Props {
  mode:      'create' | 'edit'
  supplier?: Supplier
  onSubmit:  (values: {
    name: string
    phone: string
    address: string
    notes: string
  }) => Promise<void>
  onClose:   () => void
}

export default function SupplierModal({
  mode,
  supplier,
  onSubmit,
  onClose,
}: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2 className="text-base font-semibold text-stone-900">
            {mode === 'create' ? 'Add supplier' : 'Edit supplier'}
          </h2>
          <button
            onClick={onClose}
            className="btn-ghost p-1.5 -mr-1.5"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <SupplierForm
          initial={supplier}
          onSubmit={onSubmit}
          onCancel={onClose}
          submitLabel={mode === 'create' ? 'Add supplier' : 'Save changes'}
        />
      </div>
    </div>
  )
}
