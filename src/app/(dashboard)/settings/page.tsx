'use client'

import { useEffect, useState } from 'react'
import { Copy, Check, Trash2 } from 'lucide-react'
import { useTenant } from '@/lib/tenant-client'
import AccessDenied from '@/components/access-denied'

interface TenantInfo {
  id:         string
  name:       string
  slug:       string
  plan:       string
  is_active:  boolean
  created_at: string
}

interface TeamMember {
  id:          string
  user_id:     string
  role:        string
  permissions: Record<string, boolean>
  full_name:   string
  email:       string | null
}

interface Invitation {
  id:         string
  email:      string
  role:       string
  token:      string
  expires_at: string
}

interface SettingsData {
  tenant:      TenantInfo
  members:     TeamMember[]
  invitations: Invitation[]
}

function memberInitial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase()
}

export default function SettingsPage() {
  const tenantCtx = useTenant()
  const { permissions } = tenantCtx

  const [data,          setData]          = useState<SettingsData | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [businessName,  setBusinessName]  = useState('')
  const [savingName,    setSavingName]    = useState(false)
  const [nameSuccess,   setNameSuccess]   = useState(false)

  const [inviteEmail,   setInviteEmail]   = useState('')
  const [inviting,      setInviting]      = useState(false)
  const [inviteLink,    setInviteLink]    = useState<string | null>(null)
  const [inviteEmailSent, setInviteEmailSent] = useState('')
  const [copied,        setCopied]        = useState(false)

  useEffect(() => {
    window.fetch('/api/settings')
      .then(r => r.json())
      .then(d => {
        if (d.error) {
          setError(d.error)
          return
        }
        setData(d)
        setBusinessName(d.tenant?.name ?? '')
      })
      .catch(() => setError('Failed to load settings'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    setSavingName(true)
    setNameSuccess(false)
    setError(null)

    const res = await window.fetch('/api/settings', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: businessName }),
    })

    const result = await res.json()
    if (!res.ok) {
      setError(result.error ?? 'Failed to save')
      setSavingName(false)
      return
    }

    setData(prev =>
      prev ? { ...prev, tenant: { ...prev.tenant, name: result.name } } : prev,
    )
    setNameSuccess(true)
    setSavingName(false)
  }

  async function handleRemoveMember(member: TeamMember) {
    if (member.user_id === tenantCtx.userId) return
    if (!window.confirm(`Remove ${member.full_name} from the team?`)) return

    setError(null)
    const res = await window.fetch(`/api/settings/members/${member.id}`, {
      method: 'DELETE',
    })

    const result = await res.json()
    if (!res.ok) {
      setError(result.error ?? 'Failed to remove member')
      return
    }

    setData(prev =>
      prev
        ? { ...prev, members: prev.members.filter(m => m.id !== member.id) }
        : prev,
    )
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setError(null)
    setInviteLink(null)
    setCopied(false)

    const res = await window.fetch('/api/settings/invite', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: inviteEmail, role: 'staff' }),
    })

    const result = await res.json()
    if (!res.ok) {
      setError(result.error ?? 'Failed to send invitation')
      setInviting(false)
      return
    }

    const origin = window.location.origin
    setInviteLink(`${origin}/invite/${result.token}`)
    setInviteEmailSent(result.email)
    setInviteEmail('')
    setInviting(false)
  }

  async function handleCopy() {
    if (!inviteLink) return
    await navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!permissions.canViewSettings) return <AccessDenied />

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage your business and team</p>
        </div>
      </div>

      {error && (
        <div className="text-sm text-danger bg-red-50 border border-red-200
                        rounded px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="card p-8 text-center">
          <p className="text-stone-400 text-sm">Loading settings…</p>
        </div>
      ) : (
        <>
          {/* Business info */}
          <div className="card p-5">
            <p className="section-title">Business info</p>
            <form onSubmit={handleSaveName} className="mt-4 space-y-4">
              <div className="form-group">
                <label className="label">Business name</label>
                <input
                  className="input"
                  value={businessName}
                  onChange={e => setBusinessName(e.target.value)}
                  required
                />
              </div>
              {nameSuccess && (
                <p className="text-sm text-success">Business name saved.</p>
              )}
              <button
                type="submit"
                className="btn-primary"
                disabled={savingName || !businessName.trim()}
              >
                {savingName ? 'Saving…' : 'Save'}
              </button>
            </form>
          </div>

          {/* Team members */}
          <div className="card p-5">
            <p className="section-title">Team members</p>
            <div className="mt-4 space-y-3">
              {(data?.members ?? []).map(member => {
                const isSelf = member.user_id === tenantCtx.userId
                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-3 p-3 bg-stone-50
                               rounded-lg border border-stone-200"
                  >
                    <div className="w-9 h-9 rounded-full bg-brand-100 text-brand-700
                                    flex items-center justify-center font-semibold
                                    text-sm flex-shrink-0">
                      {memberInitial(member.full_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-stone-900">
                          {member.full_name}
                          {isSelf && (
                            <span className="text-stone-400 font-normal"> (you)</span>
                          )}
                        </p>
                        <span className={`badge text-2xs ${
                          member.role === 'owner' ? 'badge-info' : 'badge-partial'
                        } capitalize`}>
                          {member.role}
                        </span>
                      </div>
                      {member.email && (
                        <p className="text-xs text-stone-500 truncate">
                          {member.email}
                        </p>
                      )}
                    </div>
                    {!isSelf && member.role !== 'owner' && (
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(member)}
                        className="btn-ghost text-danger p-2 flex-shrink-0"
                        aria-label={`Remove ${member.full_name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Invite staff */}
          <div className="card p-5">
            <p className="section-title">Invite staff</p>
            <form onSubmit={handleInvite} className="mt-4 space-y-4">
              <div className="form-group">
                <label className="label">Email</label>
                <input
                  type="email"
                  className="input"
                  placeholder="staff@example.com"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="label">Role</label>
                <select className="select" value="staff" disabled>
                  <option value="staff">Staff</option>
                </select>
              </div>
              <button
                type="submit"
                className="btn-primary"
                disabled={inviting || !inviteEmail.trim()}
              >
                {inviting ? 'Sending…' : 'Send invite'}
              </button>
            </form>

            {inviteLink && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-stone-700 mb-2">
                  Share this link with {inviteEmailSent}:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-white border border-stone-200
                                   rounded px-2 py-1.5 truncate">
                    {inviteLink}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="btn-secondary p-2 flex-shrink-0"
                    aria-label="Copy link"
                  >
                    {copied
                      ? <Check className="w-4 h-4 text-success" />
                      : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-stone-500 mt-2">
                  Link expires in 7 days
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
