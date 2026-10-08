export default function Skeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="animate-pulse overflow-hidden rounded-3xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-center gap-4 p-5">
        <div className="h-16 w-16 rounded-lg bg-slate-200 dark:bg-slate-800" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-5 w-3/4 rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-3 w-1/3 rounded bg-slate-200 dark:bg-slate-800" />
        </div>
      </div>
      <div className="space-y-3 px-5 pb-5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-slate-200 dark:bg-slate-800" />
            <div className="h-4 flex-1 rounded bg-slate-200 dark:bg-slate-800" />
          </div>
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
