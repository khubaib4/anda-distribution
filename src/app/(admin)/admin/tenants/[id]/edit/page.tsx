'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

interface TenantDetail {
  id:        string
  name:      string
  plan:      string
  is_active: boolean
}

export default function AdminTenantEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()

  const [name,      setName]      = useState('')
  const [plan,      setPlan]      = useState('trial')
  const [isActive,  setIsActive]  = useState(true)
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    window.fetch(`/api/admin/tenants/${id}`)
      .then(async r => {
        const data = await r.json()
        if (!r.ok) {
          setError(data.error ?? 'Failed to load tenant')
          return
        }
        setName(data.tenant.name)
        setPlan(data.tenant.plan)
        setIsActive(data.tenant.is_active)
      })
      .catch(() => setError('Failed to load tenant'))
      .finally(() => setLoading(false))
  }, [id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const res = await window.fetch(`/api/admin/tenants/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name:      name.trim(),
        plan,
        is_active: isActive,
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Failed to save')
      setSaving(false)
      return
    }

    router.push(`/admin/tenants/${id}`)
  }

  if (loading) {
    return (
      <div className="card p-8 text-center max-w-lg">
        <p className="text-stone-400 text-sm">Loading…</p>
      </div>
    )
  }

  return (
    <div className="max-w-lg">
      <Link
        href={`/admin/tenants/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-stone-500
                   hover:text-stone-700 mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to tenant
      </Link>

      <div className="page-header mb-6">
        <div>
          <h1 className="page-title">Edit tenant</h1>
          <p className="page-subtitle">Update business settings</p>
        </div>
      </div>

      <div className="card p-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="form-group">
            <label className="label">Business name</label>
            <input
              className="input"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="label">Plan</label>
            <select
              className="select"
              value={plan}
              onChange={e => setPlan(e.target.value)}
            >
              <option value="trial">Trial</option>
              <option value="basic">Basic</option>
              <option value="pro">Pro</option>
            </select>
          </div>

          <div className="form-group">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
                className="rounded border-stone-300"
              />
              <span className="text-sm text-stone-700">Active</span>
            </label>
          </div>

          {error && (
            <div className="text-sm text-danger bg-red-50 border border-red-200
                            rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Link
              href={`/admin/tenants/${id}`}
              className="btn-secondary"
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="btn-primary"
              disabled={saving || !name.trim()}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
