import AdminSidebar from '@/components/admin/admin-sidebar'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-stone-50 hidden lg:block">
      <div className="fixed inset-y-0 left-0 flex w-60">
        <AdminSidebar />
      </div>
      <main className="min-h-screen pl-60">
        <div className="max-w-6xl mx-auto px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  )
}
