import { Skeleton } from '@/components/ui';

/** Shown while a page is loading: a title, a lede and a few content blocks. */
export default function Loading() {
  return (
    <main className="page" aria-busy="true">
      <div role="status" className="flex flex-col gap-8">
        <span className="sr-only">Loading the page</span>
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-9 w-3/5 max-w-md" />
          <Skeleton className="h-4 w-4/5 max-w-lg" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          <Skeleton className="skeleton-block h-40" />
          <Skeleton className="skeleton-block h-40" />
          <Skeleton className="skeleton-block h-40 sm:max-lg:hidden" />
        </div>
      </div>
    </main>
  );
}
