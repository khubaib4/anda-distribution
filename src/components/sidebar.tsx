'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
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
  LogOut,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useTenant } from '@/lib/tenant-client'
import { navPermissionForHref } from '@/lib/permissions'

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

export default function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()
  const tenant   = useTenant()
  const [overdueCount, setOverdueCount] = useState(0)

  useEffect(() => {
    window.fetch('/api/alerts')
      .then(r => r.json())
      .then(d => setOverdueCount(d.counts?.overdue ?? 0))
      .catch(console.error)
  }, [pathname])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="flex flex-col w-60 bg-stone-900 min-h-screen">

      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-stone-800">
        <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-sm">A</span>
        </div>
        <div className="min-w-0">
          <p className="text-white font-semibold text-sm leading-tight truncate">
            {tenant.tenantName || 'Platform Admin'}
          </p>
          {tenant.role === 'staff' && (
            <span className="inline-block mt-0.5 text-2xs font-medium px-1.5 py-0.5
                             rounded bg-amber-500/20 text-amber-400">
              Staff
            </span>
          )}
          {tenant.role === 'super_admin' && (
            <span className="inline-block mt-0.5 text-2xs font-medium px-1.5 py-0.5
                             rounded bg-blue-500/20 text-blue-400">
              Admin
            </span>
          )}
          {tenant.role === 'owner' && (
            <p className="text-stone-500 text-xs">Owner</p>
          )}
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const permission = navPermissionForHref(href)
          if (permission && !tenant.permissions[permission]) return null

          const active = isActive(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              className={[
                'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium',
                'transition-colors duration-150',
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
            </Link>
          )
        })}
        {tenant.permissions.canViewSettings && (
          <Link
            href="/settings"
            className={[
              'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium',
              'transition-colors duration-150',
              isActive(pathname, '/settings')
                ? 'bg-brand-500 text-white'
                : 'text-stone-400 hover:text-white hover:bg-stone-800',
            ].join(' ')}
          >
            <Settings className="w-4 h-4 flex-shrink-0" />
            Settings
          </Link>
        )}
      </nav>

      {/* Sign out */}
      <div className="px-3 py-4 border-t border-stone-800">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-md
                     text-sm font-medium text-stone-400
                     hover:text-white hover:bg-stone-800
                     transition-colors duration-150"
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          Sign Out
        </button>
      </div>

    </aside>
  )
}
