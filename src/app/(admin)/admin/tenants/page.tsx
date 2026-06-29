'use client'

import { useEffect, useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Plus, Pencil, X } from 'lucide-react'
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

function TenantsPageContent() {
  const searchParams = useSearchParams()
  const created = searchParams.get('created') === '1'

  const [tenants, setTenants] = useState<AdminTenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [success, setSuccess] = useState(created)

  const [editTenant, setEditTenant] = useState<AdminTenant | null>(null)
  const [editName,   setEditName]   = useState('')
  const [editPlan,   setEditPlan]   = useState('trial')
  const [saving,     setSaving]     = useState(false)

  async function loadTenants() {
    setLoading(true)
    setError(null)
    try {
      const res = await window.fetch('/api/admin/tenants')
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to load tenants')
        return
      }
      setTenants(data)
    } catch {
      setError('Failed to load tenants')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTenants()
  }, [])

  function openEdit(t: AdminTenant) {
    setEditTenant(t)
    setEditName(t.name)
    setEditPlan(t.plan)
  }

  async function handleSaveEdit() {
    if (!editTenant) return
    setSaving(true)
    setError(null)

    const res = await window.fetch(`/api/admin/tenants/${editTenant.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: editName, plan: editPlan }),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Failed to update tenant')
      setSaving(false)
      return
    }

    setTenants(prev => prev.map(t => (t.id === editTenant.id ? data : t)))
    setEditTenant(null)
    setSaving(false)
  }

  async function handleToggleActive(t: AdminTenant) {
    setError(null)
    const res = await window.fetch(`/api/admin/tenants/${t.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ is_active: !t.is_active }),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Failed to update status')
      return
    }

    setTenants(prev => prev.map(row => (row.id === t.id ? data : row)))
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tenants</h1>
          <p className="page-subtitle">
            {loading ? '…' : `${tenants.length} tenant${tenants.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Link href="/admin/tenants/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          New tenant
        </Link>
      </div>

      {success && (
        <div className="mb-4 text-sm text-success bg-green-50 border border-green-200
                        rounded px-4 py-3">
          Tenant created successfully.
        </div>
      )}

      {error && (
        <div className="mb-4 text-sm text-danger bg-red-50 border border-red-200
                        rounded px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="card p-8 text-center">
          <p className="text-stone-400 text-sm">Loading tenants…</p>
        </div>
      ) : tenants.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-stone-400 text-sm mb-4">No tenants yet</p>
          <Link href="/admin/tenants/new" className="btn-primary">
            Create first tenant
          </Link>
        </div>
      ) : (
        <div className="card">
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Business name</th>
                  <th>Owner</th>
                  <th>Plan</th>
                  <th>Members</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map(t => (
                  <tr key={t.id}>
                    <td className="font-medium text-stone-900">
                      <Link
                        href={`/admin/tenants/${t.id}`}
                        className="hover:text-brand-600 transition-colors"
                      >
                        {t.name}
                      </Link>
                    </td>
                    <td className="text-stone-600">
                      {t.owner?.full_name ?? '—'}
                    </td>
                    <td>
                      <span className={`badge ${planBadgeClass(t.plan)} capitalize`}>
                        {t.plan}
                      </span>
                    </td>
                    <td className="text-stone-600">{t.member_count}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(t)}
                        className={`badge cursor-pointer ${
                          t.is_active ? 'badge-paid' : 'badge-unpaid'
                        }`}
                      >
                        {t.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="text-stone-500 whitespace-nowrap">
                      {formatDate(t.created_at)}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => openEdit(t)}
                        className="btn-ghost text-xs py-1 px-2"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editTenant && (
        <div className="modal-backdrop" onClick={() => setEditTenant(null)}>
          <div className="modal-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="text-base font-semibold text-stone-900">
                Edit tenant
              </h2>
              <button
                onClick={() => setEditTenant(null)}
                className="btn-ghost p-1.5 -mr-1.5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="modal-body space-y-4">
              <div className="form-group">
                <label className="label">Business name</label>
                <input
                  className="input"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="label">Plan</label>
                <select
                  className="select"
                  value={editPlan}
                  onChange={e => setEditPlan(e.target.value)}
                >
                  <option value="trial">Trial</option>
                  <option value="basic">Basic</option>
                  <option value="pro">Pro</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                onClick={() => setEditTenant(null)}
                className="btn-secondary"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="btn-primary"
                disabled={saving || !editName.trim()}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AdminTenantsPage() {
  return (
    <Suspense fallback={
      <div className="card p-8 text-center">
        <p className="text-stone-400 text-sm">Loading…</p>
      </div>
    }>
      <TenantsPageContent />
    </Suspense>
  )
}
