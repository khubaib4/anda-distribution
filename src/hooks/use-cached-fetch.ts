'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cache, createCacheScope } from '@/lib/cache'
import { useTenant } from '@/lib/tenant-client'

interface Options {
  ttl?:     number
  enabled?: boolean
}

interface RequestState<T> {
  requestKey: string | null
  data:       T | undefined
  loading:    boolean
  error:      string | null
}

export function useCachedFetch<T>(url: string | null, options?: Options) {
  const ttl     = options?.ttl ?? 30000
  const enabled = options?.enabled ?? true
  const { userId, tenantId } = useTenant()
  const scope = useMemo(
    () => createCacheScope(userId, tenantId),
    [userId, tenantId],
  )
  const requestKey = scope && url && enabled
    ? JSON.stringify([scope.userId, scope.tenantId, url])
    : null
  const missingScopeError = enabled && url && !scope ? 'Tenant unavailable' : null

  const [state, setState] = useState<RequestState<T>>(() => {
    const cached = scope && requestKey && url
      ? cache.get(scope, url) as T | undefined
      : undefined
    return {
      requestKey,
      data:    cached,
      loading: requestKey !== null && cached === undefined,
      error:   missingScopeError,
    }
  })
  const currentRequestKey = useRef(requestKey)
  const generation = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const activeRef = useRef(false)

  // The state tag masks old data during render. The layout effect rejects old
  // responses as soon as a different request commits, before passive cleanup.
  useLayoutEffect(() => {
    currentRequestKey.current = requestKey
  }, [requestKey])

  const cancelRequest = useCallback(() => {
    generation.current++
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  const load = useCallback(async (force = false) => {
    if (!scope || !url || !requestKey ||
        !activeRef.current || currentRequestKey.current !== requestKey) return

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const requestGeneration = ++generation.current
    const isCurrent = () =>
      activeRef.current &&
      !controller.signal.aborted &&
      generation.current === requestGeneration &&
      currentRequestKey.current === requestKey

    if (!force) {
      const cached = cache.get(scope, url) as T | undefined
      setState(previous => currentRequestKey.current === requestKey
        ? {
            requestKey,
            data:    cached,
            loading: cached === undefined,
            error:   null,
          }
        : previous)
    } else {
      setState(previous => {
        if (currentRequestKey.current !== requestKey) return previous
        const data = previous.requestKey === requestKey
          ? previous.data
          : undefined
        return { requestKey, data, loading: data === undefined, error: null }
      })
    }

    try {
      const res = await window.fetch(url, { signal: controller.signal })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(
          (body as { error?: string }).error ?? `Request failed (${res.status})`,
        )
      }
      const fresh = (await res.json()) as T
      if (!isCurrent()) return
      cache.set(scope, url, fresh, ttl)
      setState({ requestKey, data: fresh, loading: false, error: null })
    } catch (e) {
      if (!isCurrent()) return
      const message = e instanceof Error ? e.message : 'Unknown error'
      setState(previous => {
        if (currentRequestKey.current !== requestKey) return previous
        const data = previous.requestKey === requestKey
          ? previous.data
          : undefined
        return {
          requestKey,
          data,
          loading: false,
          error:   data === undefined ? message : null,
        }
      })
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [scope, url, requestKey, ttl])

  useEffect(() => {
    activeRef.current = true
    if (requestKey) {
      void load()
    }

    return () => {
      activeRef.current = false
      cancelRequest()
    }
  }, [requestKey, load, cancelRequest])

  const refetch = useCallback(async () => {
    await load(true)
  }, [load])

  const visible = requestKey && state.requestKey === requestKey
    ? state
    : {
        data:    undefined,
        loading: requestKey !== null,
        error:   missingScopeError,
      }

  return { data: visible.data, loading: visible.loading, error: visible.error, refetch }
}
