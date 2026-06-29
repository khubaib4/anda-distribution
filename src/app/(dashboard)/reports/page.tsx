'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  formatPKR,
  formatQty,
} from '@/lib/utils'
import { useTenant } from '@/lib/tenant-client'
import AccessDenied from '@/components/access-denied'

interface PLData {
  period: { from: string; to: string }
  revenue: {
    total_paisa:  number
    sales_count:  number
    total_trays:  number
    by_category:  Array<{
      name:           string
      revenue_paisa:  number
      cogs_paisa:     number
      quantity_trays: number
    }>
  }
  cogs: { total_paisa: number }
  gross_profit: {
    total_paisa: number
    margin_pct:  number
  }
  expenses: {
    total_paisa: number
    by_category: Array<{
      name:        string
      icon:        string
      total_paisa: number
    }>
  }
  net_profit: {
    total_paisa: number
    margin_pct:  number
  }
  purchases: { total_paisa: number }
}

function PLRow({
  label,
  amount,
  sub,
  bold,
  color,
  indent,
  borderTop,
  borderDouble,
}: {
  label:        string
  amount:       number
  sub?:         string
  bold?:        boolean
  color?:       string
  indent?:      boolean
  borderTop?:   boolean
  borderDouble?: boolean
}) {
  return (
    <div className={[
      'flex items-center justify-between py-2 px-4',
      borderDouble ? 'border-t-2 border-stone-300 mt-1' :
      borderTop    ? 'border-t border-stone-200' : '',
    ].join(' ')}>
      <div className={indent ? 'pl-4' : ''}>
        <p className={`text-sm ${bold ? 'font-semibold text-stone-900' : 'text-stone-600'}`}>
          {label}
        </p>
        {sub && (
          <p className="text-xs text-stone-400">{sub}</p>
        )}
      </div>
      <p className={`amount text-sm ${
        bold  ? 'font-bold' : 'font-medium'
      } ${color ?? 'text-stone-900'}`}>
        {formatPKR(amount)}
      </p>
    </div>
  )
}

export default function ReportsPage() {
  const { permissions } = useTenant()

  const today      = new Date().toISOString().split('T')[0]
  const monthStart = today.slice(0, 7) + '-01'

  const [from, setFrom] = useState(monthStart)
  const [to,   setTo]   = useState(today)
  const [data,    setData]    = useState<PLData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const loadReport = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.fetch(
        `/api/reports/pl?from=${from}&to=${to}`
      )
      if (!res.ok) throw new Error('Failed to load report')
      const json = await res.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { loadReport() }, [loadReport])

  const isProfit = (data?.net_profit.total_paisa ?? 0) >= 0

  // Quick range presets
  const presets = [
    { label: 'This month', from: monthStart,                          to: today },
    { label: 'Last 7 days', from: (() => {
        const d = new Date()
        d.setDate(d.getDate() - 7)
        return d.toISOString().split('T')[0]
      })(),                                                             to: today },
    { label: 'This year',  from: today.slice(0, 4) + '-01-01',       to: today },
  ]

  if (!permissions.canViewReports) return <AccessDenied />

  return (
    <div className="max-w-2xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="page-title">Profit & Loss</h1>
        <p className="page-subtitle">Income statement for selected period</p>
      </div>

      {/* Date range */}
      <div className="card p-4 mb-5 space-y-3">
        <p className="section-title">Period</p>

        {/* Presets */}
        <div className="flex gap-2 flex-wrap">
          {presets.map(preset => (
            <button
              key={preset.label}
              onClick={() => { setFrom(preset.from); setTo(preset.to) }}
              className={[
                'px-3 py-1.5 rounded-full text-xs font-medium',
                'transition-colors duration-150',
                from === preset.from && to === preset.to
                  ? 'bg-brand-500 text-white'
                  : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50',
              ].join(' ')}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Custom range */}
        <div className="grid grid-cols-2 gap-3">
          <div className="form-group">
            <label className="label">From</label>
            <input
              type="date"
              className="input"
              value={from}
              onChange={e => setFrom(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="label">To</label>
            <input
              type="date"
              className="input"
              value={to}
              onChange={e => setTo(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 text-sm text-danger bg-red-50 border
                        border-red-200 rounded px-4 py-3">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="card p-8 text-center">
          <p className="text-stone-400 text-sm">Loading report…</p>
        </div>
      )}

      {!loading && data && (
        <div className="space-y-4">

          {/* Summary KPI cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="stat-card text-center">
              <p className="stat-label">Revenue</p>
              <p className="stat-value text-base">
                {formatPKR(data.revenue.total_paisa)}
              </p>
              <p className="stat-sub">
                {data.revenue.sales_count} sale
                {data.revenue.sales_count !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="stat-card text-center">
              <p className="stat-label">Gross profit</p>
              <p className={`stat-value text-base ${
                data.gross_profit.total_paisa >= 0
                  ? 'text-success'
                  : 'text-danger'
              }`}>
                {formatPKR(data.gross_profit.total_paisa)}
              </p>
              <p className="stat-sub">
                {data.gross_profit.margin_pct}% margin
              </p>
            </div>
            <div className="stat-card text-center">
              <p className="stat-label">Net profit</p>
              <p className={`stat-value text-base ${
                isProfit ? 'text-success' : 'text-danger'
              }`}>
                {formatPKR(data.net_profit.total_paisa)}
              </p>
              <p className="stat-sub">
                {data.net_profit.margin_pct}% margin
              </p>
            </div>
          </div>

          {/* P&L Statement */}
          <div className="card overflow-hidden">

            {/* Revenue section */}
            <div className="px-4 py-3 bg-stone-50 border-b border-stone-200">
              <p className="text-xs font-semibold text-stone-500 uppercase
                            tracking-wider">
                Revenue
              </p>
            </div>

            {data.revenue.by_category.map(cat => (
              <PLRow
                key={cat.name}
                label={cat.name}
                amount={cat.revenue_paisa}
                sub={formatQty(cat.quantity_trays) + ' sold'}
                indent
              />
            ))}

            {data.revenue.by_category.length === 0 && (
              <div className="px-8 py-4 text-center">
                <p className="text-stone-400 text-sm">No sales in this period</p>
              </div>
            )}

            <PLRow
              label="Total revenue"
              amount={data.revenue.total_paisa}
              bold
              borderTop
            />

            {/* COGS section */}
            <div className="px-4 py-3 bg-stone-50 border-y border-stone-200 mt-2">
              <p className="text-xs font-semibold text-stone-500 uppercase
                            tracking-wider">
                Cost of goods sold
              </p>
            </div>

            <PLRow
              label="Egg purchase cost (avg)"
              amount={data.cogs.total_paisa}
              indent
              color="text-danger"
            />

            <PLRow
              label="Gross profit"
              amount={data.gross_profit.total_paisa}
              sub={`${data.gross_profit.margin_pct}% gross margin`}
              bold
              borderTop
              color={data.gross_profit.total_paisa >= 0
                ? 'text-success'
                : 'text-danger'
              }
            />

            {/* Expenses section */}
            <div className="px-4 py-3 bg-stone-50 border-y border-stone-200 mt-2">
              <p className="text-xs font-semibold text-stone-500 uppercase
                            tracking-wider">
                Operating expenses
              </p>
            </div>

            {data.expenses.by_category.map(cat => (
              <PLRow
                key={cat.name}
                label={`${cat.icon} ${cat.name}`}
                amount={cat.total_paisa}
                indent
                color="text-danger"
              />
            ))}

            {data.expenses.by_category.length === 0 && (
              <div className="px-8 py-3 text-center">
                <p className="text-stone-400 text-sm">
                  No expenses in this period
                </p>
              </div>
            )}

            <PLRow
              label="Total expenses"
              amount={data.expenses.total_paisa}
              bold
              borderTop
              color="text-danger"
            />

            {/* Net profit */}
            <div className={`flex items-center justify-between px-4 py-4
                             mt-1 border-t-2 border-stone-300 ${
              isProfit ? 'bg-green-50' : 'bg-red-50'
            }`}>
              <div>
                <p className="text-sm font-bold text-stone-900">
                  Net profit
                </p>
                <p className="text-xs text-stone-500">
                  {data.net_profit.margin_pct}% net margin
                </p>
              </div>
              <p className={`amount text-xl font-bold ${
                isProfit ? 'text-success' : 'text-danger'
              }`}>
                {formatPKR(data.net_profit.total_paisa)}
              </p>
            </div>

          </div>

          {/* Category profitability table */}
          {data.revenue.by_category.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 bg-stone-50 border-b border-stone-200">
                <p className="text-xs font-semibold text-stone-500 uppercase
                              tracking-wider">
                  Profitability by egg category
                </p>
              </div>
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th className="text-right">Qty sold</th>
                      <th className="text-right">Revenue</th>
                      <th className="text-right">COGS</th>
                      <th className="text-right">Gross profit</th>
                      <th className="text-right">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.revenue.by_category.map(cat => {
                      const profit = cat.revenue_paisa - cat.cogs_paisa
                      const margin = cat.revenue_paisa > 0
                        ? Math.round((profit / cat.revenue_paisa) * 100)
                        : 0
                      return (
                        <tr key={cat.name}>
                          <td className="font-medium text-stone-900">
                            {cat.name}
                          </td>
                          <td className="text-right qty text-stone-600">
                            {formatQty(cat.quantity_trays)}
                          </td>
                          <td className="text-right amount">
                            {formatPKR(cat.revenue_paisa)}
                          </td>
                          <td className="text-right amount text-danger">
                            {formatPKR(cat.cogs_paisa)}
                          </td>
                          <td className={`text-right amount font-medium ${
                            profit >= 0 ? 'text-success' : 'text-danger'
                          }`}>
                            {formatPKR(profit)}
                          </td>
                          <td className="text-right">
                            <span className={`text-sm font-medium ${
                              margin >= 20 ? 'text-success' :
                              margin >= 10 ? 'text-warning' :
                              'text-danger'
                            }`}>
                              {margin}%
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Purchases vs COGS note */}
          {data.purchases.total_paisa !== data.cogs.total_paisa && (
            <div className="card p-4 bg-amber-50 border-amber-200">
              <p className="text-xs text-amber-800">
                <strong>Note:</strong> Purchases this period:{' '}
                {formatPKR(data.purchases.total_paisa)} — COGS shown above
                ({formatPKR(data.cogs.total_paisa)}) reflects only the cost
                of eggs actually sold, using average purchase price.
                The difference is unsold stock.
              </p>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
