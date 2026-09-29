'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cache } from '@/lib/cache'
import {
  TenantContext,
  fetchTenantContext,
  type TenantContext as TenantContextValue,
} from '@/lib/tenant-client'

interface Props {
  children: React.ReactNode
}

interface ProviderState {
  ctx:       TenantContextValue | null
  loading:   boolean
  selection: string | null
  issue:     'select_tenant' | 'invalid_tenant' | 'tenant_not_found' | 'retry' | null
}

export default function TenantProvider({ children }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const selection = searchParams.has('tenant_id')
    ? searchParams.get('tenant_id')
    : null
  const routerRef = useRef(router)
  const [state, setState] = useState<ProviderState>({
    ctx: null, loading: true, selection, issue: null,
  })
  const mounted = useRef(false)
  const requestVersion = useRef(0)
  const revalidating = useRef(false)
  const identityController = useRef<AbortController | null>(null)
  const selectionRef = useRef(selection)
  const handledSelection = useRef(selection)
  const resolvedIdentity = useRef<{ userId: string; tenantId: string | null } | null>(null)
  const observedAuthUser = useRef<string | null | undefined>(undefined)
  const authEventSeen = useRef(false)

  useLayoutEffect(() => {
    routerRef.current = router
  }, [router])

  useLayoutEffect(() => {
    selectionRef.current = selection
  }, [selection])

  const suspendIdentity = useCallback(() => {
    requestVersion.current++
    revalidating.current = false
    identityController.current?.abort()
    identityController.current = null
    flushSync(() => setState({
      ctx: null, loading: true, selection: selectionRef.current, issue: null,
    }))
  }, [])

  const revalidateIdentity = useCallback(async function run(
    reason: 'initial' | 'auth' | 'resume' | 'selection' | 'retry',
    attempt = 0,
    requestedSelection = selectionRef.current,
  ) {
    if (reason === 'resume' && revalidating.current) return

    const version = ++requestVersion.current
    identityController.current?.abort()
    const controller = new AbortController()
    identityController.current = controller
    revalidating.current = true
    if (reason !== 'initial') {
      flushSync(() => setState({
        ctx: null, loading: true, selection: requestedSelection, issue: null,
      }))
    }

    const { data, status, errorCode } = await fetchTenantContext(
      requestedSelection, controller.signal,
    )
    if (identityController.current === controller) identityController.current = null
    if (!mounted.current || version !== requestVersion.current ||
        selectionRef.current !== requestedSelection) return
    revalidating.current = false

    const expectedUserId = observedAuthUser.current
    // The server identity cannot reveal children until browser auth is known.
    // INITIAL_SESSION will revalidate if this request has already finished.
    if (expectedUserId === undefined) return

    const authMismatch = status === 200 && data?.userId !== expectedUserId
    if (authMismatch) cache.clear()
    if (authMismatch && expectedUserId && attempt === 0) {
      // Cookie propagation can briefly lag a cross-tab auth event. Retry once,
      // keeping children hidden; never render the mismatched /api/me result.
      setTimeout(() => {
        if (mounted.current && version === requestVersion.current) {
          void run('auth', 1, selectionRef.current)
        }
      }, 0)
      return
    }

    if (!expectedUserId || authMismatch || status === 401 || status === 403 ||
        (status === 200 && (!data || (!data.isSuperAdmin && !data.tenantId)))) {
      resolvedIdentity.current = null
      cache.clear()
      setState({
        ctx: null, loading: false, selection: requestedSelection, issue: null,
      })
      routerRef.current.replace('/login')
      return
    }

    if (status !== 200 || !data) {
      resolvedIdentity.current = null
      cache.clear()
      const issue = errorCode === 'TENANT_SELECTION_INVALID'
        ? 'invalid_tenant'
        : errorCode === 'TENANT_NOT_FOUND'
          ? 'tenant_not_found'
          : 'retry'
      setState({ ctx: null, loading: false, selection: requestedSelection, issue })
      return
    }

    const selectedTenantMatches = requestedSelection !== null &&
      data.selectedTenantId?.toLowerCase() === requestedSelection.toLowerCase() &&
      data.tenantId?.toLowerCase() === requestedSelection.toLowerCase()
    if (data.isSuperAdmin && (requestedSelection === null
      ? data.selectedTenantId !== null || data.tenantId !== null
      : !selectedTenantMatches)) {
      resolvedIdentity.current = null
      cache.clear()
      setState({
        ctx: null, loading: false, selection: requestedSelection, issue: 'invalid_tenant',
      })
      return
    }

    // A hidden tab must verify again when it returns before mounting children.
    if (document.visibilityState === 'hidden') return

    const effectiveTenantId = data.isSuperAdmin ? data.selectedTenantId : data.tenantId
    const previous = resolvedIdentity.current
    if (previous &&
        (previous.userId !== data.userId || previous.tenantId !== effectiveTenantId)) {
      cache.clear()
    }
    resolvedIdentity.current = { userId: data.userId, tenantId: effectiveTenantId }
    setState({
      loading: false,
      selection: requestedSelection,
      issue: data.isSuperAdmin && !effectiveTenantId ? 'select_tenant' : null,
      ctx: {
        ...data,
        tenantId: effectiveTenantId,
        selectedTenantId: data.isSuperAdmin ? data.selectedTenantId : null,
      },
    })
  }, [])

  useEffect(() => {
    if (handledSelection.current === selection) return
    handledSelection.current = selection
    void revalidateIdentity('selection', 0, selection)
  }, [selection, revalidateIdentity])

  useEffect(() => {
    mounted.current = true
    const initialSessionTimer = setTimeout(() => {
      if (!mounted.current || observedAuthUser.current !== undefined) return
      // If browser auth never initializes, fail closed instead of loading forever.
      requestVersion.current++
      revalidating.current = false
      identityController.current?.abort()
      identityController.current = null
      resolvedIdentity.current = null
      cache.clear()
      setState({
        ctx: null, loading: false, selection: selectionRef.current, issue: null,
      })
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
      identityController.current?.abort()
      identityController.current = null
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [revalidateIdentity, suspendIdentity])

  // Auth may change after a matching response was queued but before it renders.
  if (state.selection !== selection || state.loading ||
      (state.ctx && state.ctx.userId !== observedAuthUser.current)) {
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

  if (state.issue) {
    const title = state.issue === 'select_tenant'
      ? 'Select a tenant'
      : state.issue === 'invalid_tenant'
        ? 'Invalid tenant selection'
        : state.issue === 'tenant_not_found'
          ? 'Tenant unavailable'
          : 'Unable to verify tenant'
    const message = state.issue === 'select_tenant'
      ? 'Choose a tenant to open its business dashboard.'
      : state.issue === 'invalid_tenant'
        ? 'The tenant ID in this link is invalid.'
        : state.issue === 'tenant_not_found'
          ? 'This tenant no longer exists or is unavailable.'
          : 'The tenant could not be verified. Please try again.'

    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <div className="card max-w-md w-full p-6 space-y-4">
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-stone-600">{message}</p>
          <div className="flex items-center gap-4">
            <Link href="/admin/tenants" className="btn-primary">Choose tenant</Link>
            {state.issue === 'retry' && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void revalidateIdentity('retry')}
              >
                Retry
              </button>
            )}
          </div>
        </div>
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
