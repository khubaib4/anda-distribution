'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Package,
  Egg,
  Users,
  Receipt,
} from 'lucide-react'

const tabs = [
  { href: '/',          label: 'Home',      icon: LayoutDashboard },
  { href: '/sales',     label: 'Sales',     icon: Egg             },
  { href: '/stock',     label: 'Stock',     icon: Package         },
  { href: '/customers', label: 'Customers', icon: Users           },
  { href: '/expenses',  label: 'Expenses',  icon: Receipt         },
]

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}

export default function MobileBottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-stone-200
                    flex lg:hidden">
      {tabs.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href)
        return (
          <Link
            key={href}
            href={href}
            className={[
              'flex-1 flex flex-col items-center justify-center py-2 gap-0.5',
              'text-2xs font-medium transition-colors duration-150',
              active ? 'text-brand-600' : 'text-stone-400',
            ].join(' ')}
          >
            <Icon
              className={[
                'w-5 h-5',
                active ? 'text-brand-500' : 'text-stone-400',
              ].join(' ')}
            />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
