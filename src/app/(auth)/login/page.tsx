'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function LoginForm() {
  const searchParams = useSearchParams()
  const [email,    setEmail]    = useState(() => searchParams.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState<string | null>(null)
  const [loading,  setLoading]  = useState(false)

  const router   = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError('Invalid email or password. Please try again.')
      setLoading(false)
      return
    }

    const meRes = await window.fetch('/api/me')
    const me    = await meRes.json()

    if (!meRes.ok) {
      if (meRes.status === 401 || meRes.status === 403) {
        setError('Unable to load your account. Please try again.')
      } else {
        setError(me.error ?? 'Unable to load your account. Please try again.')
      }
      setLoading(false)
      return
    }

    if (me.isSuperAdmin) {
      router.push('/admin')
      router.refresh()
      return
    }

    if (me.tenantId) {
      router.push('/')
      router.refresh()
      return
    }

    await supabase.auth.signOut()
    setError(
      'Your account is not connected to any business. Contact your administrator.',
    )
    setLoading(false)
  }

  return (
    <div className="card p-6">
      <form onSubmit={handleLogin} className="space-y-4" noValidate>

        <div className="form-group">
          <label htmlFor="email" className="label">
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="input"
            placeholder="you@example.com"
          />
        </div>

        <div className="form-group">
          <label htmlFor="password" className="label">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="input"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <div className="text-sm text-danger bg-red-50 border border-red-200
                          rounded px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full mt-2"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

      </form>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="w-full max-w-sm">

      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-brand-500 flex items-center
                        justify-center mx-auto mb-4 shadow-card">
          <span className="text-white font-bold text-2xl">D</span>
        </div>
        <h1 className="text-xl font-semibold text-stone-900">
          Doctor&apos;s Egg
        </h1>
        <p className="text-stone-500 text-sm mt-1">
          Sign in to your account
        </p>
      </div>

      <Suspense fallback={
        <div className="card p-6 text-center">
          <p className="text-stone-400 text-sm">Loading…</p>
        </div>
      }>
        <LoginForm />
      </Suspense>

      <p className="text-center text-xs text-stone-400 mt-6">
        Doctor&apos;s Egg Management System · Karachi
      </p>

    </div>
  )
}
