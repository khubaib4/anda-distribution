'use client'

import { useState } from 'react'
import { Plus, Pencil, Phone, MapPin, PowerOff, Power } from 'lucide-react'
import { useSuppliers } from '@/hooks/use-suppliers'
import SupplierModal from '@/components/suppliers/supplier-modal'
import type { Supplier } from '@/types'

type ModalState =
  | { open: false }
  | { open: true; mode: 'create' }
  | { open: true; mode: 'edit'; supplier: Supplier }

export default function SuppliersPage() {
  const { suppliers, loading, error, createSupplier, updateSupplier } =
    useSuppliers()

  const [modal,      setModal]      = useState<ModalState>({ open: false })
  const [showInactive, setShowInactive] = useState(false)

  const filtered = showInactive
    ? suppliers
    : suppliers.filter(s => s.is_active)

  async function handleCreate(values: {
    name: string; phone: string; address: string; notes: string
  }) {
    await createSupplier(values)
    setModal({ open: false })
  }

  async function handleEdit(values: {
    name: string; phone: string; address: string; notes: string
  }) {
    if (modal.open && modal.mode === 'edit') {
      await updateSupplier(modal.supplier.id, values)
      setModal({ open: false })
    }
  }

  async function handleToggleActive(s: Supplier) {
    await updateSupplier(s.id, { is_active: !s.is_active })
  }

  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Suppliers</h1>
          <p className="page-subtitle">
            {suppliers.filter(s => s.is_active).length} active supplier
            {suppliers.filter(s => s.is_active).length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setModal({ open: true, mode: 'create' })}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          Add supplier
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 text-sm text-danger bg-red-50 border border-red-200
                        rounded px-4 py-3">
          {error}
        </div>
      )}

      {/* Filter toggle */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setShowInactive(v => !v)}
          className={showInactive ? 'btn-secondary text-xs py-1' : 'btn-ghost text-xs py-1'}
        >
          {showInactive ? 'Showing all' : 'Show inactive'}
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="card p-8 text-center">
          <p className="text-stone-400 text-sm">Loading suppliers…</p>
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <p className="text-stone-400 text-sm">
              {showInactive
                ? 'No suppliers found'
                : 'No active suppliers — add your first one'}
            </p>
            <button
              onClick={() => setModal({ open: true, mode: 'create' })}
              className="btn-primary mt-4"
            >
              <Plus className="w-4 h-4" />
              Add supplier
            </button>
          </div>
        </div>
      )}

      {/* Supplier list */}
      {!loading && filtered.length > 0 && (
        <div className="card divide-y divide-stone-100">
          {filtered.map(supplier => (
            <div
              key={supplier.id}
              className={[
                'flex items-start justify-between gap-4 px-4 py-3.5',
                !supplier.is_active ? 'opacity-50' : '',
              ].join(' ')}
            >
              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-stone-900 text-sm truncate">
                    {supplier.name}
                  </p>
                  {!supplier.is_active && (
                    <span className="badge badge-unpaid flex-shrink-0">
                      Inactive
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                  {supplier.phone && (
                    <span className="flex items-center gap-1 text-xs text-stone-500">
                      <Phone className="w-3 h-3" />
                      {supplier.phone}
                    </span>
                  )}
                  {supplier.address && (
                    <span className="flex items-center gap-1 text-xs text-stone-500">
                      <MapPin className="w-3 h-3" />
                      {supplier.address}
                    </span>
                  )}
                </div>

                {supplier.notes && (
                  <p className="text-xs text-stone-400 mt-0.5 truncate">
                    {supplier.notes}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() =>
                    setModal({ open: true, mode: 'edit', supplier })
                  }
                  className="btn-ghost p-1.5"
                  aria-label="Edit supplier"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleToggleActive(supplier)}
                  className="btn-ghost p-1.5"
                  aria-label={
                    supplier.is_active ? 'Deactivate' : 'Activate'
                  }
                  title={supplier.is_active ? 'Deactivate' : 'Activate'}
                >
                  {supplier.is_active
                    ? <PowerOff className="w-3.5 h-3.5 text-stone-400" />
                    : <Power    className="w-3.5 h-3.5 text-green-600" />
                  }
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modal.open && modal.mode === 'create' && (
        <SupplierModal
          mode="create"
          onSubmit={handleCreate}
          onClose={() => setModal({ open: false })}
        />
      )}

      {modal.open && modal.mode === 'edit' && (
        <SupplierModal
          mode="edit"
          supplier={modal.supplier}
          onSubmit={handleEdit}
          onClose={() => setModal({ open: false })}
        />
      )}
    </div>
  )
}
