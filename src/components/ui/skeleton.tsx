export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-stone-200 animate-pulse rounded ${className}`} />
  )
}

export function SkeletonText({ width = 'full' }: { width?: string }) {
  return (
    <Skeleton className={`h-4 ${width === 'full' ? 'w-full' : width}`} />
  )
}

export function SkeletonCard() {
  return (
    <div className="stat-card">
      <Skeleton className="h-3 w-20 mb-3" />
      <Skeleton className="h-8 w-28" />
    </div>
  )
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <Skeleton className="w-9 h-9 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-4 w-16 flex-shrink-0" />
    </div>
  )
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className="card divide-y divide-stone-100">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  )
}
