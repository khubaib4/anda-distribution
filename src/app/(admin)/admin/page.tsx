'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Building2, ChevronRight } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface AdminTenant {
  id:           string
  name:         string
  plan:         string
  is_active:    boolean
  created_at:   string
  member_count: number
  owner:        { full_name: string } | null
}

function planBadgeClass(plan: string): string {
  if (plan === 'basic') return 'badge-info'
  if (plan === 'pro')   return 'badge-paid'
  return 'badge-partial'
}

export default function AdminDashboardPage() {
  const [tenants, setTenants] = useState<AdminTenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    window.fetch('/api/admin/tenants')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setTenants(data)
        else setError(data.error ?? 'Failed to load tenants')
      })
      .catch(() => setError('Failed to load tenants'))
      .finally(() => setLoading(false))
  }, [])

  const activeCount = tenants.filter(t => t.is_active).length
  const trialCount  = tenants.filter(t => t.plan === 'trial').length
  const recent      = tenants.slice(0, 5)

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Admin dashboard</h1>
          <p className="page-subtitle">Platform overview</p>
        </div>
        <Link href="/admin/tenants/new" className="btn-primary">
          <Building2 className="w-4 h-4" />
          New tenant
        </Link>
      </div>

      {error && (
        <div className="mb-4 text-sm text-danger bg-red-50 border border-red-200
                        rounded px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="card p-8 text-center">
          <p className="text-stone-400 text-sm">Loading…</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="stat-card">
              <p className="stat-label">Total tenants</p>
              <p className="stat-value text-2xl">{tenants.length}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Active</p>
              <p className="stat-value text-2xl text-success">{activeCount}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">On trial</p>
              <p className="stat-value text-2xl text-warning">{trialCount}</p>
            </div>
          </div>

          <div className="card">
            <div className="px-4 py-3 border-b border-stone-100 flex items-center
                            justify-between">
              <p className="section-title mb-0">Recent tenants</p>
              <Link
                href="/admin/tenants"
                className="text-xs text-brand-600 hover:text-brand-700
                           flex items-center gap-0.5"
              >
                View all <ChevronRight className="w-3 h-3" />
              </Link>
            </div>

            {recent.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-stone-400 text-sm mb-4">No tenants yet</p>
                <Link href="/admin/tenants/new" className="btn-primary">
                  Create first tenant
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-stone-100">
                {recent.map(t => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-stone-900">
                        {t.name}
                      </p>
                      <p className="text-xs text-stone-500">
                        {t.owner?.full_name ?? '—'} · {formatDate(t.created_at)}
                      </p>
                    </div>
                    <span className={`badge ${planBadgeClass(t.plan)} capitalize`}>
                      {t.plan}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
