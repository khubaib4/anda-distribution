'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Phone, ChevronRight } from 'lucide-react'
import { formatPKR } from '@/lib/utils'
import type { OverdueSale } from '@/types'

interface AlertsData {
  overdue:   OverdueSale[]
  due_today: OverdueSale[]
  counts: {
    overdue:   number
    due_today: number
    total:     number
  }
}

function AlertCard({
  sale,
  badge,
  badgeClass,
}: {
  sale:        OverdueSale
  badge:       string
  badgeClass:  string
}) {
  return (
    <div className="card px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/customers/${sale.customer_id}`}
              className="font-medium text-stone-900 text-sm
                         hover:text-brand-600 transition-colors"
            >
              {sale.contact_name}
            </Link>
            <span className={`badge ${badgeClass}`}>{badge}</span>
          </div>
          {sale.business_name && (
            <p className="text-xs text-stone-500 mt-0.5">{sale.business_name}</p>
          )}
          {sale.phone && (
            <span className="flex items-center gap-1 text-xs text-stone-400 mt-1">
              <Phone className="w-3 h-3" />
              {sale.phone}
            </span>
          )}
          <p className="text-xs text-stone-400 mt-1 font-mono">
            {sale.invoice_number ?? '—'}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="amount text-sm font-semibold text-danger">
            {formatPKR(sale.balance_paisa)}
          </p>
          <p className="text-2xs text-stone-400">owed</p>
          <Link
            href={`/customers/${sale.customer_id}`}
            className="inline-flex items-center gap-0.5 text-xs
                       text-brand-600 hover:text-brand-700 mt-1"
          >
            Ledger <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function AlertsPage() {
  const [data,    setData]    = useState<AlertsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    window.fetch('/api/alerts')
      .then(r => r.json())
      .then(setData)
      .catch(() => setError('Failed to load alerts'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-2xl mx-auto">
      <div className="page-header">
        <div>
          <h1 className="page-title">Alerts</h1>
          <p className="page-subtitle">
            {loading
              ? '…'
              : `${data?.counts.total ?? 0} payment alert${(data?.counts.total ?? 0) !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 text-sm text-danger bg-red-50 border
                        border-red-200 rounded px-4 py-3">
          {error}
        </div>
      )}

      {loading && (
        <div className="card p-8 text-center">
          <p className="text-stone-400 text-sm">Loading alerts…</p>
        </div>
      )}

      {!loading && data && (
        <div className="space-y-6">
          {/* Overdue */}
          <div>
            <p className="section-title text-danger mb-3">Overdue</p>
            {data.overdue.length === 0 ? (
              <div className="card p-8 text-center">
                <p className="text-stone-400 text-sm">
                  No overdue payments 🎉
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.overdue.map(sale => (
                  <AlertCard
                    key={sale.sale_id}
                    sale={sale}
                    badge={`${sale.days_overdue} day${sale.days_overdue !== 1 ? 's' : ''} overdue`}
                    badgeClass="badge-unpaid"
                  />
                ))}
              </div>
            )}
          </div>

          {/* Due today */}
          <div>
            <p className="section-title text-warning mb-3">Due today</p>
            {data.due_today.length === 0 ? (
              <div className="card p-8 text-center">
                <p className="text-stone-400 text-sm">
                  Nothing due today
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.due_today.map(sale => (
                  <AlertCard
                    key={sale.sale_id}
                    sale={sale}
                    badge="Due today"
                    badgeClass="badge-partial"
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
