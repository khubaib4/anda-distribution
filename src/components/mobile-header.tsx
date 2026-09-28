'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import TenantLink from '@/components/tenant-link'
import { usePathname } from 'next/navigation'
import {
  Menu,
  X,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Truck,
  Egg,
  Users,
  Receipt,
  Wallet,
  BookOpen,
  BellRing,
  Landmark,
  BarChart3,
  Settings,
  ArrowLeft,
  LogOut,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cache } from '@/lib/cache'
import { useRouter } from 'next/navigation'
import { useTenant } from '@/lib/tenant-client'
import { navPermissionForHref } from '@/lib/permissions'
import { useTenantFetch } from '@/hooks/use-tenant-fetch'

const navItems = [
  { href: '/',           label: 'Dashboard', icon: LayoutDashboard },
  { href: '/stock',      label: 'Stock',      icon: Package        },
  { href: '/purchases',  label: 'Purchases',  icon: ShoppingCart   },
  { href: '/suppliers',  label: 'Suppliers',  icon: Truck          },
  { href: '/sales',      label: 'Sales',      icon: Egg            },
  { href: '/customers',  label: 'Customers',  icon: Users          },
  { href: '/expenses',   label: 'Expenses',   icon: Receipt        },
  { href: '/capital',    label: 'Capital',    icon: Wallet         },
  { href: '/cash-book',  label: 'Cash Book',  icon: BookOpen       },
  { href: '/alerts',     label: 'Alerts',     icon: BellRing       },
  { href: '/accounts',   label: 'Accounts',   icon: Landmark       },
  { href: '/reports',    label: 'Reports',    icon: BarChart3      },
]

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}

export default function MobileHeader() {
  const [open, setOpen]  = useState(false)
  const pathname         = usePathname()
  const router           = useRouter()
  const supabase         = createClient()
  const tenant           = useTenant()
  const tenantFetch = useTenantFetch()
  const [overdueCount, setOverdueCount] = useState(0)
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)

  useEffect(() => {
    tenantFetch('/api/alerts')
      .then(r => {
        if (!r.ok) throw new Error('Failed to load alerts')
        return r.json()
      })
      .then(d => setOverdueCount(d.counts?.overdue ?? 0))
      .catch(console.error)
  }, [pathname, tenantFetch])

  async function handleLogout() {
    if (loggingOut) return
    setLoggingOut(true)
    setLogoutError(null)
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    } catch {
      setLogoutError('Unable to sign out. Please try again.')
      setLoggingOut(false)
      return
    }
    cache.clear()
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      {/* Top bar */}
      <header className="fixed top-0 inset-x-0 z-30 h-14 bg-white border-b border-stone-200
                         flex items-center justify-between px-4 lg:hidden">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-brand-500 flex items-center justify-center">
            <span className="text-white font-bold text-xs">D</span>
          </div>
          <span className="font-semibold text-stone-900 text-sm truncate">
            {tenant.tenantName || "Doctor's Egg"}
          </span>
        </div>
        <button
          onClick={() => setOpen(v => !v)}
          className="p-2 rounded-md text-stone-500 hover:bg-stone-100
                     transition-colors duration-150"
          aria-label="Toggle menu"
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </header>

      {/* Slide-out drawer */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-stone-900/70 lg:hidden"
            onClick={() => setOpen(false)}
          />

          {/* Drawer panel */}
          <div className="fixed inset-y-0 right-0 z-50 w-64 bg-stone-900
                          flex flex-col lg:hidden">

            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-5
                            border-b border-stone-800">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-md bg-brand-500 flex items-center justify-center">
                  <span className="text-white font-bold text-xs">D</span>
                </div>
                <span className="text-white font-semibold text-sm truncate">
                  {tenant.tenantName || "Doctor's Egg"}
                </span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-stone-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Nav links */}
            <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
              {navItems.map(({ href, label, icon: Icon }) => {
                const permission = navPermissionForHref(href)
                if (permission && !tenant.permissions[permission]) return null

                const active = isActive(pathname, href)
                return (
                  <TenantLink
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={[
                      'flex items-center gap-3 px-3 py-2.5 rounded-md',
                      'text-sm font-medium transition-colors duration-150',
                      active
                        ? 'bg-brand-500 text-white'
                        : 'text-stone-400 hover:text-white hover:bg-stone-800',
                    ].join(' ')}
                  >
                    <span className="relative flex-shrink-0">
                      <Icon className="w-4 h-4" />
                      {href === '/alerts' && overdueCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2
                                         bg-red-500 rounded-full" />
                      )}
                    </span>
                    {label}
                  </TenantLink>
                )
              })}
              {tenant.permissions.canViewSettings && (
                <TenantLink
                  href="/settings"
                  onClick={() => setOpen(false)}
                  className={[
                    'flex items-center gap-3 px-3 py-2.5 rounded-md',
                    'text-sm font-medium transition-colors duration-150',
                    isActive(pathname, '/settings')
                      ? 'bg-brand-500 text-white'
                      : 'text-stone-400 hover:text-white hover:bg-stone-800',
                  ].join(' ')}
                >
                  <Settings className="w-4 h-4 flex-shrink-0" />
                  Settings
                </TenantLink>
              )}
              {tenant.isSuperAdmin && tenant.selectedTenantId && (
                <Link
                  href="/admin/tenants"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-md
                             text-sm font-medium text-stone-400 hover:text-white
                             hover:bg-stone-800 transition-colors duration-150"
                >
                  <ArrowLeft className="w-4 h-4 flex-shrink-0" />
                  Exit tenant view
                </Link>
              )}
            </nav>

            {/* Sign out */}
            <div className="px-3 py-4 border-t border-stone-800">
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="flex items-center gap-3 w-full px-3 py-2.5 rounded-md
                           text-sm font-medium text-stone-400
                           hover:text-white hover:bg-stone-800
                           transition-colors duration-150"
              >
                <LogOut className="w-4 h-4" />
                {loggingOut ? 'Signing out…' : 'Sign Out'}
              </button>
              {logoutError && <p className="px-3 text-xs text-red-400">{logoutError}</p>}
            </div>

          </div>
        </>
      )}
    </>
  )
}
