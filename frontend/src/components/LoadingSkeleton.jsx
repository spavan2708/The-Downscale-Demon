export default function LoadingSkeleton({ rows = 4 }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
      <div className="mb-6 h-6 w-48 animate-pulse rounded bg-slate-800"></div>
      <div className="space-y-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="h-10 w-10 animate-pulse rounded-full bg-slate-800"></div>
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/3 animate-pulse rounded bg-slate-800"></div>
              <div className="h-3 w-1/2 animate-pulse rounded bg-slate-800"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
