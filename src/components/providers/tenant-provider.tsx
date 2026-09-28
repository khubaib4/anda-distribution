'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cache } from '@/lib/cache'
import {
  TenantContext,
  fetchTenantContext,
  type TenantContext as TenantContextValue,
} from '@/lib/tenant-client'
import { getDefaultPermissions } from '@/lib/permissions'

interface Props {
  children: React.ReactNode
}

interface ProviderState {
  ctx:     TenantContextValue | null
  loading: boolean
}

export default function TenantProvider({ children }: Props) {
  const router = useRouter()
  const routerRef = useRef(router)
  const [state, setState] = useState<ProviderState>({ ctx: null, loading: true })
  const mounted = useRef(false)
  const requestVersion = useRef(0)
  const revalidating = useRef(false)
  const resolvedIdentity = useRef<{ userId: string; tenantId: string | null } | null>(null)
  const observedAuthUser = useRef<string | null | undefined>(undefined)
  const authEventSeen = useRef(false)

  useLayoutEffect(() => {
    routerRef.current = router
  }, [router])

  const suspendIdentity = useCallback(() => {
    requestVersion.current++
    revalidating.current = false
    flushSync(() => setState({ ctx: null, loading: true }))
  }, [])

  const revalidateIdentity = useCallback(async function run(
    reason: 'initial' | 'auth' | 'resume',
    attempt = 0,
  ) {
    if (reason === 'resume' && revalidating.current) return

    const version = ++requestVersion.current
    revalidating.current = true
    if (reason !== 'initial') {
      flushSync(() => setState({ ctx: null, loading: true }))
    }

    const { data, status } = await fetchTenantContext()
    if (!mounted.current || version !== requestVersion.current) return
    revalidating.current = false

    const expectedUserId = observedAuthUser.current
    // The server identity cannot reveal children until browser auth is known.
    // INITIAL_SESSION will revalidate if this request has already finished.
    if (expectedUserId === undefined) return

    const authMismatch = (data?.userId ?? null) !== expectedUserId
    if (authMismatch) cache.clear()
    if (authMismatch && expectedUserId && attempt === 0) {
      // Cookie propagation can briefly lag a cross-tab auth event. Retry once,
      // keeping children hidden; never render the mismatched /api/me result.
      setTimeout(() => {
        if (mounted.current && version === requestVersion.current) {
          void run('auth', 1)
        }
      }, 0)
      return
    }

    if (authMismatch || status !== 200 || !data ||
        (!data.isSuperAdmin && !data.tenantId)) {
      resolvedIdentity.current = null
      cache.clear()
      setState({ ctx: null, loading: false })
      routerRef.current.replace('/login')
      return
    }

    // A hidden tab must verify again when it returns before mounting children.
    if (document.visibilityState === 'hidden') return

    const previous = resolvedIdentity.current
    if (previous &&
        (previous.userId !== data.userId || previous.tenantId !== data.tenantId)) {
      cache.clear()
    }
    resolvedIdentity.current = { userId: data.userId, tenantId: data.tenantId }
    setState({
      loading: false,
      ctx: {
        ...data,
        permissions: getDefaultPermissions(data.isSuperAdmin ? 'super_admin' : data.role),
      },
    })
  }, [])

  useEffect(() => {
    mounted.current = true
    const initialSessionTimer = setTimeout(() => {
      if (!mounted.current || observedAuthUser.current !== undefined) return
      // If browser auth never initializes, fail closed instead of loading forever.
      requestVersion.current++
      revalidating.current = false
      resolvedIdentity.current = null
      cache.clear()
      setState({ ctx: null, loading: false })
      routerRef.current.replace('/login')
    }, 10000)
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user.id ?? null
      const currentUserId = resolvedIdentity.current?.userId ?? null

      // INITIAL_SESSION reconciles the first /api/me result before any reveal.
      // SIGNED_IN can also fire on focus, and token refreshes keep the same user.
      if (event === 'INITIAL_SESSION') {
        if (authEventSeen.current) return
        observedAuthUser.current = userId
        if (userId && !resolvedIdentity.current && revalidating.current) return
        if (userId && userId === currentUserId) return
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' ||
                 event === 'PASSWORD_RECOVERY') {
        authEventSeen.current = true
        observedAuthUser.current = userId
        if (userId && userId === currentUserId) return
      } else if (event !== 'SIGNED_OUT' && event !== 'USER_UPDATED') {
        return
      } else {
        authEventSeen.current = true
        observedAuthUser.current = userId
      }

      cache.clear()
      void revalidateIdentity('auth')
    })

    let wasHidden = document.visibilityState === 'hidden'
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        wasHidden = true
        suspendIdentity()
      } else if (wasHidden) {
        wasHidden = false
        void revalidateIdentity('resume')
      }
    }
    const onPageHide = () => {
      wasHidden = true
      suspendIdentity()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        wasHidden = false
        void revalidateIdentity('resume')
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    if (!wasHidden) {
      queueMicrotask(() => {
        if (mounted.current && !revalidating.current) {
          void revalidateIdentity('initial')
        }
      })
    }

    const versionRef = requestVersion
    return () => {
      mounted.current = false
      clearTimeout(initialSessionTimer)
      versionRef.current++
      revalidating.current = false
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [revalidateIdentity, suspendIdentity])

  // Auth may change after a matching response was queued but before it renders.
  if (state.loading || (state.ctx && state.ctx.userId !== observedAuthUser.current)) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center
                      justify-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-brand-500 flex items-center
                        justify-center">
          <span className="text-white font-bold text-lg">D</span>
        </div>
        <p className="text-sm text-stone-500">Loading…</p>
      </div>
    )
  }

  if (!state.ctx) return null

  return (
    <TenantContext.Provider
      key={JSON.stringify([state.ctx.userId, state.ctx.tenantId])}
      value={state.ctx}
    >
      {children}
    </TenantContext.Provider>
  )
}
