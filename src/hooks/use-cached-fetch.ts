'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cache } from '@/lib/cache'

interface Options {
  ttl?:     number
  enabled?: boolean
}

export function useCachedFetch<T>(url: string | null, options?: Options) {
  const ttl     = options?.ttl ?? 30000
  const enabled = options?.enabled ?? true

  const [data, setData]       = useState<T | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const dataRef               = useRef<T | undefined>(undefined)

  const load = useCallback(async (force = false) => {
    if (!url || !enabled) return

    if (!force) {
      const cached = cache.get(url)
      if (cached !== undefined) {
        setData(cached as T)
        dataRef.current = cached as T
        setLoading(false)
      } else {
        setLoading(true)
      }
    } else if (dataRef.current === undefined) {
      setLoading(true)
    }

    setError(null)

    try {
      const res = await window.fetch(url)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(
          (body as { error?: string }).error ?? `Request failed (${res.status})`,
        )
      }
      const fresh = (await res.json()) as T
      cache.set(url, fresh, ttl)
      setData(fresh)
      dataRef.current = fresh
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error'
      if (!force && cache.get(url) !== undefined) return
      if (dataRef.current === undefined) {
        setError(message)
      }
    } finally {
      setLoading(false)
    }
  }, [url, enabled, ttl])

  useEffect(() => {
    if (!enabled || !url) {
      setLoading(false)
      setData(undefined)
      dataRef.current = undefined
      return
    }

    const cached = cache.get(url)
    if (cached !== undefined) {
      setData(cached as T)
      dataRef.current = cached as T
      setLoading(false)
    } else {
      setData(undefined)
      dataRef.current = undefined
      setLoading(true)
    }

    load()
  }, [url, enabled, load])

  const refetch = useCallback(async () => {
    await load(true)
  }, [load])

  return { data, loading, error, refetch }
}
