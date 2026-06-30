'use client'

import { useState } from 'react'
import { Plus, Pencil, Phone, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useCustomers } from '@/hooks/use-customers'
import CustomerModal from '@/components/customers/customer-modal'
import { formatPKR, customerTypeLabel } from '@/lib/utils'
import type { CustomerBalance } from '@/types'
import { SkeletonList } from '@/components/ui/skeleton'

type ModalState =
  | { open: false }
  | { open: true; mode: 'create' }
  | { open: true; mode: 'edit'; customer: CustomerBalance }

const typeFilters = [
  { value: '',            label: 'All'         },
  { value: 'shop',        label: 'Shops'       },
  { value: 'restaurant',  label: 'Restaurants' },
  { value: 'wholesaler',  label: 'Wholesalers' },
  { value: 'other',       label: 'Other'       },
]

export default function CustomersPage() {
  const [typeFilter,    setTypeFilter]    = useState('')
  const [showInactive,  setShowInactive]  = useState(false)
  const [modal,         setModal]         = useState<ModalState>({ open: false })

  const { customers, loading, error, createCustomer, updateCustomer } =
    useCustomers({ type: typeFilter || undefined, inactive: showInactive })

  // Summary
  const totalReceivable = customers.reduce(
    (s, c) => s + Math.max(0, c.balance_paisa), 0
  )
  const withBalance = customers.filter(c => c.balance_paisa > 0).length

  async function handleCreate(values: {
    contact_name:  string
    business_name: string
    phone:         string
    address:       string
    customer_type: string
    notes:         string
  }) {
    await createCustomer(values)
    setModal({ open: false })
  }

  async function handleEdit(values: {
    contact_name:  string
    business_name: string
    phone:         string
    address:       string
    customer_type: string
    notes:         string
  }) {
    if (modal.open && modal.mode === 'edit') {
      await updateCustomer(modal.customer.customer_id, values)
      setModal({ open: false })
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="page-subtitle">
            {loading
              ? '…'
              : `${customers.length} customer${customers.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={() => setModal({ open: true, mode: 'create' })}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Add customer</span>
          <span className="sm:hidden">Add</span>
        </button>
      </div>

      {/* Summary */}
      {!loading && customers.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="stat-card">
            <p className="stat-label">Total receivable</p>
            <p className="stat-value text-xl text-danger">
              {formatPKR(totalReceivable)}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">With balance due</p>
            <p className="stat-value text-xl">{withBalance}</p>
            <p className="stat-sub">
              of {customers.length} customer{customers.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      )}

      {/* Type filter tabs */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto no-scrollbar pb-1">
        {typeFilters.map(f => (
          <button
            key={f.value}
            onClick={() => setTypeFilter(f.value)}
            className={[
              'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap',
              'transition-colors duration-150 flex-shrink-0',
              typeFilter === f.value
                ? 'bg-brand-500 text-white'
                : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}

        <button
          onClick={() => setShowInactive(v => !v)}
          className={[
            'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ml-auto',
            'transition-colors duration-150 flex-shrink-0',
            showInactive
              ? 'bg-stone-700 text-white'
              : 'bg-white border border-stone-200 text-stone-500 hover:bg-stone-50',
          ].join(' ')}
        >
          {showInactive ? 'Showing inactive' : 'Show inactive'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 text-sm text-danger bg-red-50 border
                        border-red-200 rounded px-4 py-3">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && <SkeletonList count={6} />}

      {/* Empty */}
      {!loading && customers.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <p className="text-stone-400 text-sm">
              {typeFilter
                ? 'No customers in this category'
                : 'No customers yet — add your first one'}
            </p>
            {!typeFilter && (
              <button
                onClick={() => setModal({ open: true, mode: 'create' })}
                className="btn-primary mt-4"
              >
                <Plus className="w-4 h-4" />
                Add customer
              </button>
            )}
          </div>
        </div>
      )}

      {/* Customer list */}
      {!loading && customers.length > 0 && (
        <div className="card divide-y divide-stone-100">
          {customers.map(customer => (
            <div
              key={customer.customer_id}
              className="flex items-center gap-3 px-4 py-3.5"
            >
              {/* Avatar */}
              <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center
                              justify-center flex-shrink-0">
                <span className="text-brand-700 font-semibold text-sm">
                  {customer.contact_name.charAt(0).toUpperCase()}
                </span>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/customers/${customer.customer_id}`}
                    className="font-medium text-stone-900 text-sm hover:text-brand-600
                               truncate transition-colors"
                  >
                    {customer.contact_name}
                  </Link>
                  {customer.customer_type && (
                    <span className="badge badge-info flex-shrink-0 text-2xs">
                      {customerTypeLabel(customer.customer_type)}
                    </span>
                  )}
                </div>

                {customer.business_name && (
                  <p className="text-xs text-stone-500 truncate">
                    {customer.business_name}
                  </p>
                )}

                <div className="flex flex-wrap gap-x-3 mt-0.5">
                  {customer.phone && (
                    <span className="flex items-center gap-1 text-2xs text-stone-400">
                      <Phone className="w-2.5 h-2.5" />
                      {customer.phone}
                    </span>
                  )}
                </div>
              </div>

              {/* Balance + actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="text-right">
                  {customer.balance_paisa > 0 ? (
                    <>
                      <p className="amount text-sm text-danger font-medium">
                        {formatPKR(customer.balance_paisa)}
                      </p>
                      <p className="text-2xs text-stone-400">due</p>
                    </>
                  ) : customer.balance_paisa < 0 ? (
                    <>
                      <p className="amount text-sm text-success font-medium">
                        {formatPKR(Math.abs(customer.balance_paisa))}
                      </p>
                      <p className="text-2xs text-stone-400">advance</p>
                    </>
                  ) : (
                    <p className="text-xs text-stone-400">Settled</p>
                  )}
                </div>

                <button
                  onClick={e => {
                    e.preventDefault()
                    setModal({ open: true, mode: 'edit', customer })
                  }}
                  className="btn-ghost p-1.5"
                  aria-label="Edit customer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>

                <Link
                  href={`/customers/${customer.customer_id}`}
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
        <CustomerModal
          mode="create"
          onSubmit={handleCreate}
          onClose={() => setModal({ open: false })}
        />
      )}

      {modal.open && modal.mode === 'edit' && (
        <CustomerModal
          mode="edit"
          customer={modal.customer}
          onSubmit={handleEdit}
          onClose={() => setModal({ open: false })}
        />
      )}
    </div>
  )
}
