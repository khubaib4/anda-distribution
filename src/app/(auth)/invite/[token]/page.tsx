'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { CheckCircle, Eye, EyeOff } from 'lucide-react'

interface InvitationDetails {
  email:       string
  role:        string
  tenant_name: string
  tenant_id:   string
  expires_at:  string
}

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>()

  const [loading,      setLoading]      = useState(true)
  const [fetchError,   setFetchError]   = useState<string | null>(null)
  const [invitation,   setInvitation]   = useState<InvitationDetails | null>(null)

  const [fullName,     setFullName]     = useState('')
  const [password,     setPassword]     = useState('')
  const [confirm,      setConfirm]      = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm,  setShowConfirm]  = useState(false)
  const [submitting,   setSubmitting]   = useState(false)
  const [submitError,  setSubmitError]  = useState<string | null>(null)
  const [success,      setSuccess]      = useState(false)
  const [createdEmail, setCreatedEmail] = useState('')

  useEffect(() => {
    window.fetch(`/api/invite/${token}`)
      .then(async r => {
        const data = await r.json()
        if (!r.ok) {
          setFetchError(data.error ?? 'Invitation not found')
          return
        }
        setInvitation(data)
      })
      .catch(() => setFetchError('Failed to load invitation'))
      .finally(() => setLoading(false))
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)

    if (password.length < 8) {
      setSubmitError('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      setSubmitError('Passwords do not match')
      return
    }

    setSubmitting(true)

    const res = await window.fetch(`/api/invite/${token}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, password, full_name: fullName }),
    })

    const data = await res.json()
    if (!res.ok) {
      setSubmitError(data.error ?? 'Failed to create account')
      setSubmitting(false)
      return
    }

    setCreatedEmail(data.email)
    setSuccess(true)
    setSubmitting(false)
  }

  if (loading) {
    return (
      <div className="w-full max-w-sm text-center">
        <div className="card p-8">
          <p className="text-stone-400 text-sm">Loading invitation…</p>
        </div>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="w-full max-w-sm">
        <div className="card p-6 text-center">
          <p className="text-stone-900 font-medium mb-2">Invalid invitation</p>
          <p className="text-sm text-stone-500 mb-6">{fetchError}</p>
          <Link href="/login" className="btn-secondary inline-flex">
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  if (success) {
    const loginHref = `/login?email=${encodeURIComponent(createdEmail)}`
    return (
      <div className="w-full max-w-sm">
        <div className="card p-6 text-center">
          <CheckCircle className="w-12 h-12 text-success mx-auto mb-4" />
          <p className="text-stone-900 font-medium mb-2">
            Account created! You can now sign in.
          </p>
          <p className="text-sm text-stone-500 mb-6">
            Your account for {createdEmail} is ready.
          </p>
          <Link href={loginHref} className="btn-primary inline-flex">
            Sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">

      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-amber-500 flex items-center
                        justify-center mx-auto mb-4 shadow-card">
          <span className="text-white font-bold text-2xl">D</span>
        </div>
        <h1 className="text-xl font-semibold text-stone-900">
          You&apos;ve been invited!
        </h1>
        <p className="text-stone-500 text-sm mt-1">
          Join {invitation?.tenant_name} on Doctor&apos;s Egg
        </p>
        {invitation && (
          <p className="text-stone-400 text-xs mt-2 capitalize">
            Invited as: {invitation.role} · {invitation.email}
          </p>
        )}
      </div>

      <div className="card p-6">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>

          <div className="form-group">
            <label htmlFor="full_name" className="label">
              Full name
            </label>
            <input
              id="full_name"
              type="text"
              autoComplete="name"
              required
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="input"
              placeholder="Your full name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password" className="label">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="input pr-10"
                placeholder="At least 8 characters"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1
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
            <label htmlFor="confirm" className="label">
              Confirm password
            </label>
            <div className="relative">
              <input
                id="confirm"
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className="input pr-10"
                placeholder="Repeat password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1
                           text-stone-400 hover:text-stone-600"
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
              >
                {showConfirm
                  ? <EyeOff className="w-4 h-4" />
                  : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {submitError && (
            <div className="text-sm text-danger bg-red-50 border border-red-200
                            rounded px-3 py-2">
              {submitError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full mt-2"
          >
            {submitting ? 'Creating account…' : 'Accept invitation & create account'}
          </button>

        </form>
      </div>

      <p className="text-center text-xs text-stone-400 mt-6">
        Already have an account?{' '}
        <Link href="/login" className="text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>

    </div>
  )
}
