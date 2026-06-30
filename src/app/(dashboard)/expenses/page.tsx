'use client'

import { useState } from 'react'
import { Plus, ChevronDown, X } from 'lucide-react'
import { useExpenses, useExpenseCategories } from '@/hooks/use-expenses'
import ExpenseForm from '@/components/expenses/expense-form'
import { formatPKR, formatDate } from '@/lib/utils'
import { SkeletonList } from '@/components/ui/skeleton'

export default function ExpensesPage() {
  const [showForm,    setShowForm]    = useState(false)
  const [categoryId,  setCategoryId]  = useState('')
  const [from,        setFrom]        = useState('')
  const [to,          setTo]          = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const { expenses, loading, error, createExpense } = useExpenses({
    category_id: categoryId || undefined,
    from:        from       || undefined,
    to:          to         || undefined,
  })

  const { categories } = useExpenseCategories()

  const totalAmount = expenses.reduce(
    (s, e) => s + e.amount_paisa, 0
  )

  // Group by category for summary
  const byCategory = categories
    .map(cat => ({
      ...cat,
      total: expenses
        .filter(e => e.category_id === cat.id)
        .reduce((s, e) => s + e.amount_paisa, 0),
    }))
    .filter(c => c.total > 0)
    .sort((a, b) => b.total - a.total)

  async function handleSubmit(values: Parameters<typeof createExpense>[0]) {
    await createExpense(values)
    setShowForm(false)
  }

  const hasFilters = categoryId || from || to

  function clearFilters() {
    setCategoryId('')
    setFrom('')
    setTo('')
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="page-subtitle">
            {loading
              ? '…'
              : `${expenses.length} expense${expenses.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Add expense</span>
          <span className="sm:hidden">Add</span>
        </button>
      </div>

      {/* Inline add form */}
      {showForm && (
        <div className="card p-4 mb-5">
          <div className="flex items-center justify-between mb-4">
            <p className="section-title mb-0">New expense</p>
            <button
              onClick={() => setShowForm(false)}
              className="btn-ghost p-1.5 -mr-1.5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <ExpenseForm
            onSubmit={handleSubmit}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {/* Summary cards */}
      {!loading && expenses.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="stat-card">
            <p className="stat-label">Total expenses</p>
            <p className="stat-value text-xl">{formatPKR(totalAmount)}</p>
            <p className="stat-sub">
              {expenses.length} transaction
              {expenses.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Top category</p>
            {byCategory.length > 0 ? (
              <>
                <p className="stat-value text-xl">
                  {byCategory[0].icon} {byCategory[0].name}
                </p>
                <p className="stat-sub">
                  {formatPKR(byCategory[0].total)}
                </p>
              </>
            ) : (
              <p className="stat-value text-xl">—</p>
            )}
          </div>
        </div>
      )}

      {/* Category breakdown */}
      {!loading && byCategory.length > 1 && (
        <div className="card p-4 mb-5">
          <p className="section-title mb-3">By category</p>
          <div className="space-y-2">
            {byCategory.map(cat => {
              const pct = totalAmount > 0
                ? Math.round((cat.total / totalAmount) * 100)
                : 0
              return (
                <div key={cat.id}>
                  <div className="flex items-center justify-between
                                  text-sm mb-1">
                    <span className="text-stone-700">
                      {cat.icon} {cat.name}
                    </span>
                    <span className="amount text-stone-900">
                      {formatPKR(cat.total)}
                      <span className="text-stone-400 font-sans
                                       font-normal ml-1.5 text-xs">
                        {pct}%
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-400 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4">
        <button
          onClick={() => setShowFilters(v => !v)}
          className="btn-ghost text-sm flex items-center gap-1.5"
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform
              ${showFilters ? 'rotate-180' : ''}`}
          />
          Filters
          {hasFilters && (
            <span className="ml-1 w-2 h-2 rounded-full bg-brand-500
                             inline-block" />
          )}
        </button>

        {showFilters && (
          <div className="mt-3 p-4 card space-y-3">
            <div className="form-group">
              <label className="label">Category</label>
              <select
                className="select"
                value={categoryId}
                onChange={e => setCategoryId(e.target.value)}
              >
                <option value="">All categories</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="form-group">
                <label className="label">From date</label>
                <input
                  type="date"
                  className="input"
                  value={from}
                  onChange={e => setFrom(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="label">To date</label>
                <input
                  type="date"
                  className="input"
                  value={to}
                  onChange={e => setTo(e.target.value)}
                />
              </div>
            </div>
            {hasFilters && (
              <button onClick={clearFilters} className="btn-ghost text-xs">
                Clear filters
              </button>
            )}
          </div>
        )}
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
      {!loading && expenses.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <p className="text-stone-400 text-sm">
              {hasFilters
                ? 'No expenses match these filters'
                : 'No expenses yet — add your first one'}
            </p>
            {!hasFilters && (
              <button
                onClick={() => setShowForm(true)}
                className="btn-primary mt-4"
              >
                <Plus className="w-4 h-4" />
                Add expense
              </button>
            )}
          </div>
        </div>
      )}

      {/* Expense list */}
      {!loading && expenses.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="card hidden sm:block">
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Details</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map(expense => (
                    <tr key={expense.id}>
                      <td className="whitespace-nowrap text-stone-500 text-xs">
                        {formatDate(expense.expense_date)}
                      </td>
                      <td>
                        <span className="text-sm">
                          {expense.category?.icon}{' '}
                          {expense.category?.name}
                        </span>
                      </td>
                      <td className="text-stone-900 font-medium">
                        {expense.description}
                      </td>
                      <td className="text-xs text-stone-400">
                        {expense.worker_name && (
                          <span>{expense.worker_name}</span>
                        )}
                        {expense.vehicle && (
                          <span>{expense.vehicle}</span>
                        )}
                        {expense.labor_type && (
                          <span className="ml-1 capitalize">
                            · {expense.labor_type}
                          </span>
                        )}
                        {expense.odometer_km && (
                          <span className="ml-1">
                            · {expense.odometer_km} km
                          </span>
                        )}
                      </td>
                      <td className="text-right">
                        <span className="amount font-medium text-stone-900">
                          {formatPKR(expense.amount_paisa)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>

                {/* Total row */}
                <tfoot>
                  <tr className="bg-stone-50 border-t-2 border-stone-200">
                    <td colSpan={4} className="px-4 py-2.5">
                      <span className="text-xs font-semibold text-stone-600
                                       uppercase tracking-wider">
                        Total
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="amount text-sm font-bold text-stone-900">
                        {formatPKR(totalAmount)}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden card divide-y divide-stone-100">
            {expenses.map(expense => (
              <div key={expense.id} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base leading-none">
                        {expense.category?.icon}
                      </span>
                      <p className="font-medium text-stone-900 text-sm truncate">
                        {expense.description}
                      </p>
                    </div>
                    <p className="text-xs text-stone-500 mt-0.5 ml-6">
                      {expense.category?.name} ·{' '}
                      {formatDate(expense.expense_date)}
                    </p>
                    {(expense.worker_name || expense.vehicle) && (
                      <p className="text-xs text-stone-400 mt-0.5 ml-6">
                        {expense.worker_name || expense.vehicle}
                        {expense.labor_type && (
                          <span className="capitalize ml-1">
                            · {expense.labor_type}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <p className="amount text-sm font-medium text-stone-900
                                flex-shrink-0">
                    {formatPKR(expense.amount_paisa)}
                  </p>
                </div>
              </div>
            ))}

            {/* Mobile total */}
            <div className="px-4 py-3 bg-stone-50 flex justify-between
                            items-center">
              <span className="text-xs font-semibold text-stone-600
                               uppercase tracking-wider">
                Total
              </span>
              <span className="amount text-sm font-bold text-stone-900">
                {formatPKR(totalAmount)}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
