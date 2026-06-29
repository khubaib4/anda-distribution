import Link from 'next/link'
import { Lock } from 'lucide-react'

export default function AccessDenied() {
  return (
    <div className="max-w-md mx-auto mt-12">
      <div className="card p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center
                        justify-center mx-auto mb-4">
          <Lock className="w-6 h-6 text-stone-500" />
        </div>
        <h1 className="text-stone-900 font-semibold text-lg mb-2">
          Access Restricted
        </h1>
        <p className="text-sm text-stone-500 mb-1">
          You don&apos;t have permission to view this page.
        </p>
        <p className="text-sm text-stone-500 mb-6">
          Contact your business owner to request access.
        </p>
        <Link href="/" className="btn-secondary inline-flex">
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
