export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/** Map + branch list placeholder for /customer */
export function BranchPageSkeleton() {
  return (
    <div className="fade-in" aria-hidden>
      <SkeletonBlock className="h-72 w-full rounded-[1.1rem]" />
      <div className="mt-4 grid gap-3">
        {[0, 1].map((i) => (
          <div key={i} className="card p-4 flex items-center gap-4">
            <SkeletonBlock className="rounded-full w-9 h-9 shrink-0" />
            <div className="flex-1 grid gap-2">
              <SkeletonBlock className="h-4 w-2/5" />
              <SkeletonBlock className="h-3.5 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Barber cards placeholder for the branch page */
export function BarberListSkeleton() {
  return (
    <div className="grid gap-4 fade-in" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="card p-5">
          <div className="flex gap-4">
            <SkeletonBlock className="rounded-full w-[76px] h-[76px] shrink-0" />
            <div className="flex-1 grid gap-2 content-start pt-1">
              <SkeletonBlock className="h-5 w-1/2" />
              <SkeletonBlock className="h-3.5 w-3/4" />
              <SkeletonBlock className="h-3.5 w-1/3" />
            </div>
          </div>
          <SkeletonBlock className="h-12 w-full mt-4 rounded-2xl" />
        </div>
      ))}
    </div>
  );
}

/** Booking form placeholder */
export function BookFormSkeleton() {
  return (
    <div className="grid gap-5 fade-in" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card p-5 grid gap-3">
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="h-12 w-full rounded-[0.8rem]" />
        </div>
      ))}
      <SkeletonBlock className="h-14 w-full rounded-2xl" />
    </div>
  );
}

/** Barber dashboard placeholder */
export function BarberDashboardSkeleton() {
  return (
    <div className="fade-in" aria-hidden>
      <div className="flex items-center justify-between">
        <div className="grid gap-2">
          <SkeletonBlock className="h-3 w-32" />
          <SkeletonBlock className="h-7 w-48" />
        </div>
        <SkeletonBlock className="h-5 w-20" />
      </div>
      <div className="grid grid-cols-4 gap-2.5 mt-5">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonBlock key={i} className="h-[72px] w-full rounded-[1.1rem]" />
        ))}
      </div>
      <div className="mt-5 grid gap-2.5">
        <SkeletonBlock className="h-28 w-full rounded-[1.1rem]" />
        <SkeletonBlock className="h-20 w-full rounded-[1.1rem]" />
        <SkeletonBlock className="h-20 w-full rounded-[1.1rem]" />
      </div>
    </div>
  );
}

/** Owner dashboard tab-content placeholder */
export function OwnerTabSkeleton() {
  return (
    <div className="grid gap-2.5 fade-in" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card p-4 grid gap-2">
          <SkeletonBlock className="h-4 w-2/5" />
          <SkeletonBlock className="h-3.5 w-3/4" />
        </div>
      ))}
    </div>
  );
}
