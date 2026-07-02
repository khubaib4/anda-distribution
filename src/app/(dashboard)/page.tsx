'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ShoppingCart,
  Users,
  Receipt,
  TrendingUp,
  ArrowRight,
  X,
} from 'lucide-react'
import {
  formatPKR,
  formatQty,
  formatDate,
  paymentStatusClass,
  paymentStatusLabel,
} from '@/lib/utils'
import { SkeletonCard, SkeletonText } from '@/components/ui/skeleton'

interface DashboardData {
  today: {
    sales_total:    number
    sales_count:    number
    expenses_total: number
    date:           string
  }
  month: {
    sales_total:    number
    cogs_total:     number
    gross_profit:   number
    expenses_total: number
    net_profit:     number
  }
  receivables: {
    total_paisa:            number
    customers_with_balance: number
  }
  stock: {
    items: Array<{
      egg_category_id: string
      egg_category:    string
      quantity_eggs:   number
      quantity_trays:  number
      display_order:   number
    }>
    total_trays: number
    total_eggs:  number
  }
  recent_sales: Array<{
    id:             string
    sale_date:      string
    invoice_number: string
    payment_status: string
    total_paisa:    number
    customer?: {
      contact_name:  string
      business_name: string | null
    }
    items: Array<{
      quantity_trays:       number
      price_per_tray_paisa: number
    }>
  }>
  alerts: {
    overdue_count: number
  }
}

export default function DashboardPage() {
  const [data,    setData]    = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [alertDismissed, setAlertDismissed] = useState(false)

  useEffect(() => {
    window.fetch('/api/dashboard')
      .then(r => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const today = new Date().toLocaleDateString('en-PK', {
    weekday: 'long',
    day:     'numeric',
    month:   'long',
    year:    'numeric',
  })

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonText width="w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    )
  }

  const lowStockItems = (data?.stock.items ?? []).filter(
    s => s.quantity_eggs > 0 && s.quantity_eggs < 240,
  )
  const outOfStockItems = (data?.stock.items ?? []).filter(
    s => s.quantity_eggs === 0,
  )

  const totalStockPeti = Math.floor((data?.stock.total_eggs ?? 0) / 360)

  function stockFromEggs(eggs: number) {
    return {
      peti:  Math.floor(eggs / 360),
      trays: Math.floor((eggs % 360) / 30),
    }
  }

  function stockSummary(eggs: number): string {
    const { peti, trays } = stockFromEggs(eggs)
    if (peti > 0 && trays > 0) return `${peti} peti ${trays} tray`
    if (peti > 0) return `${peti} peti`
    if (trays > 0) return `${trays} tray`
    return '0'
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">{today}</p>
      </div>

      {/* Stock alerts */}
      {!alertDismissed &&
        (lowStockItems.length > 0 || outOfStockItems.length > 0) && (
        <div className={`rounded-lg px-4 py-3 border text-sm flex items-start
                         justify-between gap-3 ${
          outOfStockItems.length > 0
            ? 'bg-red-50 border-red-200 text-red-800'
            : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}>
          <div className="flex items-start gap-3 min-w-0">
            <span className="text-base flex-shrink-0">
              {outOfStockItems.length > 0 ? '🚨' : '⚠️'}
            </span>
            <div>
              {outOfStockItems.length > 0 && (
                <p className="font-medium">
                  Out of stock:{' '}
                  {outOfStockItems.map(s => s.egg_category).join(', ')}
                </p>
              )}
              {lowStockItems.length > 0 && (
                <p className={outOfStockItems.length > 0 ? 'mt-0.5' : ''}>
                  Low stock:{' '}
                  {lowStockItems.map(s =>
                    `${s.egg_category} (${stockSummary(s.quantity_eggs)})`
                  ).join(', ')}
                </p>
              )}
              <Link
                href="/stock"
                className="inline-flex items-center gap-1 mt-1 font-medium
                           underline underline-offset-2"
              >
                View stock <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAlertDismissed(true)}
            className="ml-auto flex-shrink-0 p-0.5 rounded hover:bg-red-100
                       transition-colors"
            aria-label="Dismiss alert"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Payment alerts */}
      {(data?.alerts.overdue_count ?? 0) > 0 && (
        <div className="rounded-lg px-4 py-3 border text-sm flex items-start
                         gap-3 bg-amber-50 border-amber-200 text-amber-800">
          <span className="text-base flex-shrink-0">⚠</span>
          <div>
            <p className="font-medium">
              {data?.alerts.overdue_count} overdue payment
              {(data?.alerts.overdue_count ?? 0) !== 1 ? 's' : ''} — customers
              who haven&apos;t paid by due date
            </p>
            <Link
              href="/alerts"
              className="inline-flex items-center gap-1 mt-1 font-medium
                         underline underline-offset-2"
            >
              View alerts <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}

      {/* Today's KPI cards */}
      <div>
        <p className="section-title">Today</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">

          <div className="stat-card">
            <p className="stat-label">Sales</p>
            <p className="stat-value">
              {formatPKR(data?.today.sales_total ?? 0)}
            </p>
            <p className="stat-sub">
              {data?.today.sales_count ?? 0} sale
              {(data?.today.sales_count ?? 0) !== 1 ? 's' : ''}
            </p>
          </div>

          <div className="stat-card">
            <p className="stat-label">Expenses</p>
            <p className="stat-value text-danger">
              {formatPKR(data?.today.expenses_total ?? 0)}
            </p>
            <p className="stat-sub">today</p>
          </div>

          <div className="stat-card">
            <p className="stat-label">Receivables</p>
            <p className="stat-value text-warning">
              {formatPKR(data?.receivables.total_paisa ?? 0)}
            </p>
            <p className="stat-sub">
              {data?.receivables.customers_with_balance ?? 0} customer
              {(data?.receivables.customers_with_balance ?? 0) !== 1
                ? 's'
                : ''
              } owe
            </p>
          </div>

          <div className="stat-card">
            <p className="stat-label">Stock</p>
            <p className="stat-value">
              {totalStockPeti}
              <span className="text-sm font-normal text-stone-400 ml-1">
                peti
              </span>
            </p>
            <p className="stat-sub">total available</p>
          </div>

        </div>
      </div>

      {/* This month summary */}
      <div>
        <p className="section-title">This month</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">

          <div className="stat-card">
            <p className="stat-label">Revenue</p>
            <p className="stat-value text-xl">
              {formatPKR(data?.month.sales_total ?? 0)}
            </p>
          </div>

          <div className="stat-card">
            <p className="stat-label">Cost of goods</p>
            <p className="stat-value text-xl text-danger">
              {formatPKR(data?.month.cogs_total ?? 0)}
            </p>
          </div>

          <div className="stat-card col-span-2 sm:col-span-1">
            <p className="stat-label">Net profit</p>
            <p className={`stat-value text-xl ${
              (data?.month.net_profit ?? 0) >= 0
                ? 'text-success'
                : 'text-danger'
            }`}>
              {formatPKR(data?.month.net_profit ?? 0)}
            </p>
            <p className="stat-sub">
              after expenses
            </p>
          </div>

        </div>
      </div>

      {/* Stock snapshot */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="section-title mb-0">Stock snapshot</p>
          <Link
            href="/stock"
            className="text-xs text-brand-600 hover:text-brand-700
                       font-medium flex items-center gap-1"
          >
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(data?.stock.items ?? []).map(cat => {
            const eggs = cat.quantity_eggs
            const { peti, trays } = stockFromEggs(eggs)
            const low  = eggs > 0 && eggs < 240
            const out  = eggs === 0
            return (
              <div
                key={cat.egg_category_id}
                className={`card p-3 ${
                  out  ? 'border-red-200'    :
                  low  ? 'border-amber-200'  : ''
                }`}
              >
                <p className="text-xs font-medium text-stone-500">
                  {cat.egg_category}
                </p>
                <p className="qty text-xl font-semibold text-stone-900 mt-1">
                  {out ? (
                    <span className="text-sm text-danger">Out of stock</span>
                  ) : (
                    <>
                      {peti}
                      <span className="text-xs font-normal text-stone-400 ml-1">
                        peti
                      </span>
                    </>
                  )}
                </p>
                {!out && trays > 0 && (
                  <p className="text-sm text-stone-600 mt-0.5">
                    {trays} tray{trays !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Recent sales */}
      {(data?.recent_sales.length ?? 0) > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="section-title mb-0">Recent sales</p>
            <Link
              href="/sales"
              className="text-xs text-brand-600 hover:text-brand-700
                         font-medium flex items-center gap-1"
            >
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="card divide-y divide-stone-100">
            {data?.recent_sales.map(sale => {
              const totalTrays = sale.items.reduce(
                (s, i) => s + i.quantity_trays, 0
              )
              const totalPaisa = sale.items.reduce(
                (s, i) => s + i.quantity_trays * i.price_per_tray_paisa, 0
              )
              return (
                <Link
                  key={sale.id}
                  href="/sales"
                  className="flex items-center justify-between gap-3
                             px-4 py-3 hover:bg-stone-50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-900 truncate">
                      {sale.customer?.contact_name ?? '—'}
                    </p>
                    <p className="text-xs text-stone-400">
                      {formatDate(sale.sale_date)} ·{' '}
                      {formatQty(totalTrays)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="amount text-sm font-medium text-stone-900">
                      {formatPKR(totalPaisa)}
                    </span>
                    <span className={paymentStatusClass(sale.payment_status)}>
                      {paymentStatusLabel(sale.payment_status)}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div>
        <p className="section-title">Quick actions</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              href:  '/sales/new',
              icon:  TrendingUp,
              label: 'New sale',
              color: 'text-brand-600',
              bg:    'bg-brand-50',
            },
            {
              href:  '/purchases/new',
              icon:  ShoppingCart,
              label: 'New purchase',
              color: 'text-blue-600',
              bg:    'bg-blue-50',
            },
            {
              href:  '/customers',
              icon:  Users,
              label: 'Customers',
              color: 'text-purple-600',
              bg:    'bg-purple-50',
            },
            {
              href:  '/expenses',
              icon:  Receipt,
              label: 'Add expense',
              color: 'text-red-600',
              bg:    'bg-red-50',
            },
          ].map(action => (
            <Link
              key={action.href}
              href={action.href}
              className="card p-4 flex flex-col items-center gap-2
                         hover:shadow-card-hover transition-shadow
                         text-center cursor-pointer"
            >
              <div className={`w-10 h-10 rounded-xl ${action.bg}
                              flex items-center justify-center`}>
                <action.icon className={`w-5 h-5 ${action.color}`} />
              </div>
              <p className="text-sm font-medium text-stone-700">
                {action.label}
              </p>
            </Link>
          ))}
        </div>
      </div>

    </div>
  )
}
