'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, Building2, LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const navItems = [
  { href: '/admin',         label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/tenants', label: 'Tenants',   icon: Building2       },
]

function isActive(pathname: string, href: string) {
  if (href === '/admin') return pathname === '/admin'
  return pathname.startsWith(href)
}

export default function AdminSidebar() {
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
      <div className="px-5 py-5 border-b border-stone-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center
                          justify-center flex-shrink-0">
            <span className="text-white font-bold text-sm">D</span>
          </div>
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm leading-tight">
              Doctor&apos;s Egg
            </p>
            <span className="inline-block mt-0.5 text-2xs font-semibold px-1.5
                             py-0.5 rounded bg-red-500/20 text-red-400 uppercase
                             tracking-wide">
              Admin
            </span>
          </div>
        </div>
        <p className="text-stone-500 text-xs mt-2">Super Admin Panel</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
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
