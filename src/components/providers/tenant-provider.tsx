'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  TenantContext,
  fetchTenantContext,
  type TenantContext as TenantContextValue,
} from '@/lib/tenant-client'
import { getDefaultPermissions } from '@/lib/permissions'

interface Props {
  children: React.ReactNode
}

export default function TenantProvider({ children }: Props) {
  const router = useRouter()
  const [ctx,     setCtx]     = useState<TenantContextValue | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTenantContext()
      .then(({ data, status }) => {
        if (status !== 200 || !data) {
          router.replace('/login')
          return
        }

        if (data.isSuperAdmin) {
          setCtx({
            ...data,
            permissions: getDefaultPermissions('super_admin'),
          })
          return
        }

        if (!data.tenantId) {
          router.replace('/login')
          return
        }

        setCtx({
          ...data,
          permissions: getDefaultPermissions(data.role),
        })
      })
      .catch(() => router.replace('/login'))
      .finally(() => setLoading(false))
  }, [router])

  if (loading) {
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

  if (!ctx) return null

  return (
    <TenantContext.Provider value={ctx}>
      {children}
    </TenantContext.Provider>
  )
}
