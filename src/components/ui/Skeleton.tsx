interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`shimmer rounded-lg bg-white/[0.04] ${className}`}
    />
  );
}

export function SkeletonText({ lines = 1, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}

export function TokenSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3">
      <Skeleton className="w-9 h-9 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

export function QuoteSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex justify-between">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      ))}
    </div>
  );
}
