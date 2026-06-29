'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Eye, EyeOff } from 'lucide-react'

export default function NewTenantPage() {
  const router = useRouter()

  const [tenantName,      setTenantName]      = useState('')
  const [ownerFullName,   setOwnerFullName]   = useState('')
  const [ownerEmail,      setOwnerEmail]      = useState('')
  const [ownerPassword,   setOwnerPassword]   = useState('')
  const [plan,            setPlan]            = useState('trial')
  const [showPassword,    setShowPassword]    = useState(false)
  const [saving,          setSaving]          = useState(false)
  const [error,           setError]           = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (ownerPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setSaving(true)

    try {
      const res = await window.fetch('/api/admin/tenants', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_name:     tenantName,
          owner_full_name: ownerFullName,
          owner_email:     ownerEmail,
          owner_password:  ownerPassword,
          plan,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Failed to create tenant')
        setSaving(false)
        return
      }

      router.push('/admin/tenants?created=1')
    } catch {
      setError('Network error — please try again')
      setSaving(false)
    }
  }

  return (
    <div className="max-w-lg">
      <Link
        href="/admin/tenants"
        className="inline-flex items-center gap-1.5 text-sm text-stone-500
                   hover:text-stone-700 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Tenants
      </Link>

      <div className="mb-6">
        <h1 className="page-title">New tenant</h1>
        <p className="page-subtitle">
          Create a business account and owner login
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="card p-5 space-y-4">
        {error && (
          <div className="text-sm text-danger bg-red-50 border border-red-200
                          rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="form-group">
          <label className="label">
            Business name <span className="text-danger">*</span>
          </label>
          <input
            className="input"
            placeholder="e.g. Ahmed Eggs Karachi"
            value={tenantName}
            onChange={e => setTenantName(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label className="label">
            Owner full name <span className="text-danger">*</span>
          </label>
          <input
            className="input"
            placeholder="e.g. Ahmed Khan"
            value={ownerFullName}
            onChange={e => setOwnerFullName(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label className="label">
            Owner email <span className="text-danger">*</span>
          </label>
          <input
            type="email"
            className="input"
            placeholder="owner@example.com"
            value={ownerEmail}
            onChange={e => setOwnerEmail(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label className="label">
            Owner password <span className="text-danger">*</span>
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              className="input pr-10"
              placeholder="Min. 8 characters"
              minLength={8}
              value={ownerPassword}
              onChange={e => setOwnerPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5
                         text-stone-400 hover:text-stone-600"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword
                ? <EyeOff className="w-4 h-4" />
                : <Eye className="w-4 h-4" />}
            </button>
          </div>
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

        <div className="flex gap-3 pt-2">
          <Link href="/admin/tenants" className="btn-secondary flex-1 justify-center">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="btn-primary flex-1"
          >
            {saving ? 'Creating…' : 'Create tenant'}
          </button>
        </div>
      </form>
    </div>
  )
}
