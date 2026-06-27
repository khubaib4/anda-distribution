'use client'

import { useState } from 'react'
import { Plus, ArrowDown, ArrowUp, RefreshCw } from 'lucide-react'
import { useCurrentStock } from '@/hooks/use-stock'
import { useStockMovements } from '@/hooks/use-stock'
import { useEggCategories } from '@/hooks/use-egg-categories'
import AdjustmentModal from '@/components/stock/adjustment-modal'
import { formatQty, formatDate } from '@/lib/utils'

const movementMeta: Record<string, {
  label: string
  color: string
  sign:  '+' | '-'
}> = {
  purchase_in:    { label: 'Purchase',    color: 'text-success', sign: '+' },
  sale_out:       { label: 'Sale',        color: 'text-danger',  sign: '-' },
  adjustment_in:  { label: 'Adj. In',    color: 'text-success', sign: '+' },
  adjustment_out: { label: 'Adj. Out',   color: 'text-danger',  sign: '-' },
  opening_stock:  { label: 'Opening',    color: 'text-info',    sign: '+' },
}

export default function StockPage() {
  const [showAdjustment, setShowAdjustment] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('')

  const { stock,     loading: stockLoading,     refetch: refetchStock }     = useCurrentStock()
  const { movements, loading: movementsLoading, refetch: refetchMovements } = useStockMovements({
    category_id: categoryFilter || undefined,
    limit: 100,
  })
  const { categories } = useEggCategories()

  function handleSaved() {
    setShowAdjustment(false)
    refetchStock()
    refetchMovements()
  }

  const totalTrays = stock.reduce((s, c) => s + c.quantity_trays, 0)

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Stock</h1>
          <p className="page-subtitle">
            {stockLoading ? '…' : `${formatQty(totalTrays)} total`}
          </p>
        </div>
        <button
          onClick={() => setShowAdjustment(true)}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Adjustment</span>
          <span className="sm:hidden">Adjust</span>
        </button>
      </div>

      {/* Current stock cards */}
      <div className="mb-6">
        <p className="section-title">Current stock</p>

        {stockLoading ? (
          <div className="card p-6 text-center">
            <p className="text-stone-400 text-sm">Loading stock…</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {stock.map(cat => {
              const peti = Math.floor(cat.quantity_trays / 12)
              const rem  = cat.quantity_trays % 12
              const low  = cat.quantity_trays < 24 // less than 2 peti = low stock

              return (
                <div
                  key={cat.egg_category_id}
                  className={`card p-4 ${low && cat.quantity_trays > 0 ? 'border-amber-300' : ''}`}
                >
                  <p className="text-xs font-medium text-stone-500 mb-2">
                    {cat.egg_category}
                  </p>

                  <p className="qty text-2xl font-semibold text-stone-900">
                    {peti}
                    <span className="text-sm font-normal text-stone-400 ml-1">
                      peti
                    </span>
                  </p>

                  {rem > 0 && (
                    <p className="qty text-sm text-stone-500">
                      + {rem} tray
                    </p>
                  )}

                  <p className="text-2xs text-stone-400 mt-1">
                    {cat.quantity_trays} trays total
                  </p>

                  {low && cat.quantity_trays > 0 && (
                    <p className="text-2xs text-warning font-medium mt-1">
                      ⚠ Low stock
                    </p>
                  )}

                  {cat.quantity_trays === 0 && (
                    <p className="text-2xs text-danger font-medium mt-1">
                      Out of stock
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Movement history */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="section-title mb-0">Movement history</p>
          <div className="flex items-center gap-2">
            <select
              className="select text-xs py-1 w-36"
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
            >
              <option value="">All categories</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              onClick={() => refetchMovements()}
              className="btn-ghost p-1.5"
              aria-label="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {movementsLoading ? (
          <div className="card p-6 text-center">
            <p className="text-stone-400 text-sm">Loading movements…</p>
          </div>
        ) : movements.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-stone-400 text-sm">No movements found</p>
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
                      <th>Type</th>
                      <th>Category</th>
                      <th className="text-right">Quantity</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map(m => {
                      const meta = movementMeta[m.movement_type]
                      return (
                        <tr key={m.id}>
                          <td className="whitespace-nowrap text-stone-500">
                            {formatDate(m.movement_date)}
                          </td>
                          <td>
                            <span className={`text-xs font-medium ${meta.color}`}>
                              {meta.label}
                            </span>
                          </td>
                          <td className="font-medium text-stone-900">
                            {m.egg_category?.name ?? '—'}
                          </td>
                          <td className="text-right">
                            <span className={`qty font-medium ${meta.color}`}>
                              {meta.sign}{formatQty(m.quantity_trays)}
                            </span>
                          </td>
                          <td className="text-stone-400 text-xs truncate max-w-[200px]">
                            {m.notes ?? '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile list */}
            <div className="sm:hidden card divide-y divide-stone-100">
              {movements.map(m => {
                const meta = movementMeta[m.movement_type]
                const isIn = meta.sign === '+'
                return (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={`w-7 h-7 rounded-full flex items-center
                                    justify-center flex-shrink-0
                                    ${isIn ? 'bg-green-50' : 'bg-red-50'}`}>
                      {isIn
                        ? <ArrowDown className="w-3.5 h-3.5 text-success" />
                        : <ArrowUp   className="w-3.5 h-3.5 text-danger"  />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-stone-900">
                        {m.egg_category?.name ?? '—'}
                        <span className={`ml-2 text-xs ${meta.color}`}>
                          {meta.label}
                        </span>
                      </p>
                      <p className="text-xs text-stone-400">
                        {formatDate(m.movement_date)}
                        {m.notes ? ` · ${m.notes}` : ''}
                      </p>
                    </div>
                    <p className={`qty text-sm font-medium ${meta.color} flex-shrink-0`}>
                      {meta.sign}{formatQty(m.quantity_trays)}
                    </p>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Adjustment modal */}
      {showAdjustment && (
        <AdjustmentModal
          onClose={() => setShowAdjustment(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
