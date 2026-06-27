'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email,    setEmail]    = useState('')
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

    router.push('/')
    router.refresh()
  }

  return (
    <div className="w-full max-w-sm">

      {/* Brand mark */}
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-brand-500 flex items-center
                        justify-center mx-auto mb-4 shadow-card">
          <span className="text-white font-bold text-2xl">A</span>
        </div>
        <h1 className="text-xl font-semibold text-stone-900">
          Anda Distribution
        </h1>
        <p className="text-stone-500 text-sm mt-1">
          Sign in to your account
        </p>
      </div>

      {/* Card */}
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

      <p className="text-center text-xs text-stone-400 mt-6">
        Anda Distribution Management System · Karachi
      </p>

    </div>
  )
}
