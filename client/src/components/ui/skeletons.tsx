import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/** Metric card skeleton matching MetricsOverview layout */
export function MetricCardSkeleton() {
  return (
    <div className="metric-card rounded-xl p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-28" />
        </div>
        <Skeleton className="w-12 h-12 rounded-xl" />
      </div>
    </div>
  );
}

/** Grid of 4 metric card skeletons */
export function MetricsGridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <MetricCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Chart/visualization skeleton with aspect ratio hint */
export function ChartSkeleton({ className, height = 250 }: { className?: string; height?: number }) {
  return (
    <div className={cn("modern-card rounded-xl p-6", className)}>
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="h-5 w-5 rounded" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="relative" style={{ height }}>
        {/* Fake chart axes */}
        <div className="absolute left-0 top-0 bottom-6 w-8 flex flex-col justify-between">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-6" />
          ))}
        </div>
        {/* Fake chart bars/area */}
        <div className="absolute left-10 right-0 top-2 bottom-6 flex items-end gap-1">
          {Array.from({ length: 20 }).map((_, i) => (
            <Skeleton
              key={i}
              className="flex-1 rounded-t"
              style={{ height: `${30 + Math.sin(i * 0.5) * 25 + Math.random() * 20}%` }}
            />
          ))}
        </div>
        {/* Fake x-axis */}
        <div className="absolute left-10 right-0 bottom-0 flex justify-between">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-8" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Table row skeleton */
export function TableRowSkeleton({ columns = 6 }: { columns?: number }) {
  return (
    <tr className="border-b border-border">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className={cn("h-4", i === 0 ? "w-24" : i === columns - 1 ? "w-16" : "w-20")} />
        </td>
      ))}
    </tr>
  );
}

/** Full table skeleton with header */
export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="modern-card rounded-xl overflow-hidden">
      <div className="p-4 flex items-center justify-between border-b border-border">
        <Skeleton className="h-5 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24 rounded-lg" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i} className="px-4 py-3 text-left">
                <Skeleton className="h-3 w-16" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <TableRowSkeleton key={i} columns={columns} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Small card skeleton for side panels */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("modern-card rounded-xl p-5", className)}>
      <div className="flex items-center gap-3 mb-4">
        <Skeleton className="w-10 h-10 rounded-lg" />
        <div className="space-y-1.5 flex-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    </div>
  );
}

/** Pie/donut chart skeleton */
export function PieChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("modern-card rounded-xl p-6", className)}>
      <Skeleton className="h-5 w-36 mb-4" />
      <div className="flex items-center justify-center" style={{ height: 200 }}>
        <Skeleton className="w-40 h-40 rounded-full" />
      </div>
      <div className="flex justify-center gap-4 mt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Skeleton className="w-3 h-3 rounded-full" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
