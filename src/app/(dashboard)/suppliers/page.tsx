'use client'

import { useState } from 'react'
import { Plus, Pencil, Phone, PowerOff, Power, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useSuppliers } from '@/hooks/use-suppliers'
import SupplierModal from '@/components/suppliers/supplier-modal'
import { formatPKR } from '@/lib/utils'
import type { SupplierBalance } from '@/types'

type ModalState =
  | { open: false }
  | { open: true; mode: 'create' }
  | { open: true; mode: 'edit'; supplier: SupplierBalance }

export default function SuppliersPage() {
  const { suppliers, loading, error, createSupplier, updateSupplier } =
    useSuppliers()

  const [modal,        setModal]        = useState<ModalState>({ open: false })
  const [showInactive, setShowInactive] = useState(false)

  const filtered = showInactive
    ? suppliers
    : suppliers.filter(s => s.is_active)

  const totalOwed = suppliers
    .filter(s => s.is_active)
    .reduce((sum, s) => sum + Math.max(0, s.balance_paisa), 0)

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
      await updateSupplier(modal.supplier.supplier_id, values)
      setModal({ open: false })
    }
  }

  async function handleToggleActive(s: SupplierBalance) {
    await updateSupplier(s.supplier_id, { is_active: !s.is_active })
  }

  return (
    <div>
      {/* Header */}
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

      {/* Summary */}
      {!loading && totalOwed > 0 && (
        <div className="stat-card mb-5">
          <p className="stat-label">Total owed to suppliers</p>
          <p className="stat-value text-xl text-danger">
            {formatPKR(totalOwed)}
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 text-sm text-danger bg-red-50 border
                        border-red-200 rounded px-4 py-3">
          {error}
        </div>
      )}

      {/* Filter */}
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
              key={supplier.supplier_id}
              className={`flex items-center gap-3 px-4 py-3.5
                ${!supplier.is_active ? 'opacity-50' : ''}`}
            >
              {/* Avatar */}
              <div className="w-9 h-9 rounded-full bg-stone-100 flex
                              items-center justify-center flex-shrink-0">
                <span className="text-stone-600 font-semibold text-sm">
                  {supplier.name.charAt(0).toUpperCase()}
                </span>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/suppliers/${supplier.supplier_id}`}
                    className="font-medium text-stone-900 text-sm
                               hover:text-brand-600 truncate transition-colors"
                  >
                    {supplier.name}
                  </Link>
                  {!supplier.is_active && (
                    <span className="badge badge-unpaid flex-shrink-0">
                      Inactive
                    </span>
                  )}
                </div>
                {supplier.phone && (
                  <span className="flex items-center gap-1 text-xs
                                   text-stone-400 mt-0.5">
                    <Phone className="w-3 h-3" />
                    {supplier.phone}
                  </span>
                )}
              </div>

              {/* Balance + actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="text-right">
                  {supplier.balance_paisa > 0 ? (
                    <>
                      <p className="amount text-sm text-danger font-medium">
                        {formatPKR(supplier.balance_paisa)}
                      </p>
                      <p className="text-2xs text-stone-400">owed</p>
                    </>
                  ) : supplier.balance_paisa < 0 ? (
                    <>
                      <p className="amount text-sm text-success font-medium">
                        {formatPKR(Math.abs(supplier.balance_paisa))}
                      </p>
                      <p className="text-2xs text-stone-400">advance</p>
                    </>
                  ) : (
                    <p className="text-xs text-stone-400">Settled</p>
                  )}
                </div>

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
                  aria-label={supplier.is_active ? 'Deactivate' : 'Activate'}
                >
                  {supplier.is_active
                    ? <PowerOff className="w-3.5 h-3.5 text-stone-400" />
                    : <Power    className="w-3.5 h-3.5 text-green-600" />
                  }
                </button>

                <Link
                  href={`/suppliers/${supplier.supplier_id}`}
                  className="btn-ghost p-1.5"
                  aria-label="View ledger"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
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
          supplier={modal.supplier as any}
          onSubmit={handleEdit}
          onClose={() => setModal({ open: false })}
        />
      )}
    </div>
  )
}
