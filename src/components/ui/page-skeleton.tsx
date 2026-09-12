import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-level loading states. Skeletons keep the page's shape so the eye has
 * somewhere to rest; a spinner in the middle of an empty column does not.
 * Each variant mirrors the layout of the page it stands in for.
 */
function HeaderSkeleton() {
  return (
    <div className="mb-6 flex items-start justify-between gap-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-9 w-28" />
    </div>
  );
}

function RowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex gap-4 border-b bg-muted px-4 py-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-40" />
        <Skeleton className="ml-auto h-3 w-16" />
      </div>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-[38%]" />
          <Skeleton className="h-5 w-16 rounded-md" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

export function TablePageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <HeaderSkeleton />
      <div className="space-y-4">
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-14 w-full rounded-xl" />
        <RowsSkeleton rows={rows} />
      </div>
    </div>
  );
}

export function DetailPageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-6 w-[60%]" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 rounded-md" />
          <Skeleton className="h-5 w-24 rounded-md" />
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="space-y-5">
          <div className="card space-y-2 p-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-[92%]" />
            <Skeleton className="h-4 w-[70%]" />
          </div>
          <div className="card divide-y">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="space-y-2 p-4">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-[80%]" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-5">
          <div className="card space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full rounded-lg" />
            ))}
          </div>
          <div className="card space-y-2.5 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex justify-between">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-28" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <HeaderSkeleton />
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="card space-y-3 p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-12" />
            </div>
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <RowsSkeleton rows={6} />
          <div className="space-y-5">
            <div className="card space-y-3 p-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
