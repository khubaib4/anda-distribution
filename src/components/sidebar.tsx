'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Truck,
  Egg,
  Users,
  Receipt,
  Wallet,
  BarChart3,
  LogOut,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const navItems = [
  { href: '/',           label: 'Dashboard', icon: LayoutDashboard },
  { href: '/stock',      label: 'Stock',      icon: Package        },
  { href: '/purchases',  label: 'Purchases',  icon: ShoppingCart   },
  { href: '/suppliers',  label: 'Suppliers',  icon: Truck          },
  { href: '/sales',      label: 'Sales',      icon: Egg            },
  { href: '/customers',  label: 'Customers',  icon: Users          },
  { href: '/expenses',   label: 'Expenses',   icon: Receipt        },
  { href: '/capital',    label: 'Capital',    icon: Wallet         },
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
            Anda Distribution
          </p>
          <p className="text-stone-500 text-xs">Karachi</p>
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
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
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          )
        })}
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
