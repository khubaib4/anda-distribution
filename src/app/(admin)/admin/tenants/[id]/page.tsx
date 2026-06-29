'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Pencil,
  Copy,
  Check,
  AlertTriangle,
} from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface TenantDetail {
  id:           string
  name:         string
  slug:         string
  plan:         string
  is_active:    boolean
  created_at:   string
  member_count: number
  owner:        { full_name: string; email: string | null } | null
}

interface Member {
  id:        string
  user_id:   string
  role:      string
  full_name: string
  email:     string | null
  joined_at: string
}

interface Invitation {
  id:         string
  email:      string
  role:       string
  expires_at: string
  created_at: string
}

function planBadgeClass(plan: string): string {
  if (plan === 'basic') return 'badge-info'
  if (plan === 'pro')   return 'badge-paid'
  return 'badge-partial'
}

export default function AdminTenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)

  const [tenant,      setTenant]      = useState<TenantDetail | null>(null)
  const [members,     setMembers]     = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [copied,      setCopied]      = useState(false)
  const [deactivating,setDeactivating]= useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res  = await window.fetch(`/api/admin/tenants/${id}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to load tenant')
        return
      }
      setTenant(data.tenant)
      setMembers(data.members ?? [])
      setInvitations(data.invitations ?? [])
    } catch {
      setError('Failed to load tenant')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [id])

  async function handleToggleActive() {
    if (!tenant) return
    setDeactivating(true)
    setError(null)

    const res = await window.fetch(`/api/admin/tenants/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ is_active: !tenant.is_active }),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Failed to update tenant')
      setDeactivating(false)
      return
    }

    setTenant(prev => prev ? { ...prev, is_active: data.is_active } : prev)
    setDeactivating(false)
  }

  async function handleCopyTenantId() {
    if (!tenant) return
    await navigator.clipboard.writeText(tenant.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="card p-8 text-center">
        <p className="text-stone-400 text-sm">Loading tenant…</p>
      </div>
    )
  }

  if (error && !tenant) {
    return (
      <div>
        <Link
          href="/admin/tenants"
          className="inline-flex items-center gap-1.5 text-sm text-stone-500
                     hover:text-stone-700 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to tenants
        </Link>
        <div className="text-sm text-danger bg-red-50 border border-red-200
                        rounded px-4 py-3">
          {error}
        </div>
      </div>
    )
  }

  if (!tenant) return null

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          href="/admin/tenants"
          className="inline-flex items-center gap-1.5 text-sm text-stone-500
                     hover:text-stone-700 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to tenants
        </Link>
        <div className="page-header">
          <div>
            <h1 className="page-title">{tenant.name}</h1>
            <p className="page-subtitle">{tenant.slug}</p>
          </div>
          <Link href={`/admin/tenants/${id}/edit`} className="btn-secondary">
            <Pencil className="w-4 h-4" />
            Edit
          </Link>
        </div>
      </div>

      {error && (
        <div className="text-sm text-danger bg-red-50 border border-red-200
                        rounded px-4 py-3">
          {error}
        </div>
      )}

      {/* Tenant info */}
      <div className="card p-5">
        <p className="section-title">Tenant info</p>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-stone-500">Plan</dt>
            <dd className="mt-0.5">
              <span className={`badge ${planBadgeClass(tenant.plan)} capitalize`}>
                {tenant.plan}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Status</dt>
            <dd className="mt-0.5">
              <span className={`badge ${
                tenant.is_active ? 'badge-paid' : 'badge-unpaid'
              }`}>
                {tenant.is_active ? 'Active' : 'Inactive'}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Created</dt>
            <dd className="mt-0.5 text-stone-900">{formatDate(tenant.created_at)}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Members</dt>
            <dd className="mt-0.5 text-stone-900">{tenant.member_count}</dd>
          </div>
        </dl>
      </div>

      {/* Owner */}
      <div className="card p-5">
        <p className="section-title">Owner</p>
        {tenant.owner ? (
          <dl className="mt-4 space-y-2 text-sm">
            <div>
              <dt className="text-stone-500">Name</dt>
              <dd className="text-stone-900">{tenant.owner.full_name}</dd>
            </div>
            {tenant.owner.email && (
              <div>
                <dt className="text-stone-500">Email</dt>
                <dd className="text-stone-900">{tenant.owner.email}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="mt-4 text-sm text-stone-400">No owner assigned</p>
        )}
      </div>

      {/* Members */}
      <div className="card p-5">
        <p className="section-title">Team members</p>
        <div className="mt-4 space-y-2">
          {members.length === 0 ? (
            <p className="text-sm text-stone-400">No members</p>
          ) : (
            members.map(m => (
              <div
                key={m.id}
                className="flex items-center justify-between p-3 bg-stone-50
                           rounded-lg border border-stone-200 text-sm"
              >
                <div>
                  <p className="font-medium text-stone-900">{m.full_name}</p>
                  {m.email && (
                    <p className="text-xs text-stone-500">{m.email}</p>
                  )}
                </div>
                <div className="text-right">
                  <span className={`badge capitalize ${
                    m.role === 'owner' ? 'badge-info' : 'badge-partial'
                  }`}>
                    {m.role}
                  </span>
                  <p className="text-xs text-stone-400 mt-1">
                    Joined {formatDate(m.joined_at)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Pending invitations */}
      <div className="card p-5">
        <p className="section-title">Pending invitations</p>
        <div className="mt-4 space-y-2">
          {invitations.length === 0 ? (
            <p className="text-sm text-stone-400">No pending invitations</p>
          ) : (
            invitations.map(inv => (
              <div
                key={inv.id}
                className="flex items-center justify-between p-3 bg-stone-50
                           rounded-lg border border-stone-200 text-sm"
              >
                <div>
                  <p className="font-medium text-stone-900">{inv.email}</p>
                  <p className="text-xs text-stone-500 capitalize">{inv.role}</p>
                </div>
                <p className="text-xs text-stone-400">
                  Expires {formatDate(inv.expires_at)}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="card p-5">
        <p className="section-title">Quick actions</p>
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-sm text-stone-600 mb-2">
              Login as this tenant — append{' '}
              <code className="text-xs bg-stone-100 px-1 py-0.5 rounded">
                ?tenant_id=
              </code>{' '}
              to dashboard API calls and settings pages when signed in as super admin.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-stone-50 border border-stone-200
                               rounded px-2 py-1.5 truncate">
                {tenant.id}
              </code>
              <button
                type="button"
                onClick={handleCopyTenantId}
                className="btn-secondary p-2 flex-shrink-0"
                aria-label="Copy tenant ID"
              >
                {copied
                  ? <Check className="w-4 h-4 text-success" />
                  : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <Link
              href={`/?tenant_id=${tenant.id}`}
              className="btn-primary inline-flex mt-3 text-sm"
            >
              Open dashboard as tenant
            </Link>
          </div>
          <div>
            <button
              type="button"
              onClick={handleToggleActive}
              disabled={deactivating}
              className="btn-secondary"
            >
              {tenant.is_active ? 'Deactivate tenant' : 'Activate tenant'}
            </button>
          </div>
        </div>
      </div>

      {/* Danger zone */}
      {!tenant.is_active && (
        <div className="card p-5 border-red-200">
          <p className="section-title text-danger flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Danger zone
          </p>
          <p className="mt-2 text-sm text-stone-500">
            This tenant is currently inactive. Users cannot access their dashboard
            until reactivated.
          </p>
        </div>
      )}
      {tenant.is_active && (
        <div className="card p-5 border-red-200">
          <p className="section-title text-danger flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Danger zone
          </p>
          <p className="mt-2 text-sm text-stone-500 mb-4">
            Deactivating blocks all users in this tenant from accessing the app.
          </p>
          <button
            type="button"
            onClick={handleToggleActive}
            disabled={deactivating}
            className="btn-danger"
          >
            {deactivating ? 'Processing…' : 'Deactivate tenant'}
          </button>
        </div>
      )}
    </div>
  )
}
