import Sidebar from '@/components/sidebar'
import MobileHeader from '@/components/mobile-header'
import MobileBottomNav from '@/components/mobile-bottom-nav'
import TenantProvider from '@/components/providers/tenant-provider'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <TenantProvider>
      <div className="min-h-screen bg-stone-50">

        {/* Desktop sidebar — hidden on mobile */}
        <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-60">
          <Sidebar />
        </div>

        {/* Mobile top bar + drawer */}
        <MobileHeader />

        {/* Page content */}
        <main
          className={[
            'min-h-screen',
            'lg:pl-60',
            'pt-14 lg:pt-0',
            'pb-20 lg:pb-0',
          ].join(' ')}
        >
          <div className="max-w-5xl mx-auto px-4 py-6">
            {children}
          </div>
        </main>

        {/* Mobile bottom nav */}
        <MobileBottomNav />

      </div>
    </TenantProvider>
  )
}
