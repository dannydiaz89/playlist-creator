import { cn } from '@/lib/design';

/**
 * Loading placeholders.
 *
 * Convex's useQuery returns `undefined` while loading and `[]` when a query
 * genuinely has no rows. Rendering both the same way flashes "No surveys yet"
 * at someone who has plenty — these components keep the two states distinct.
 *
 * The pulse is disabled under prefers-reduced-motion by the global rule.
 */
export function Skeleton({ className }: { className?: string }) {
  return <span className={cn('block bg-slate-200 rounded animate-pulse', className)} aria-hidden="true" />;
}

/** Rows shaped like the table they stand in for, so the layout does not jump. */
export function TableSkeleton({
  columns, rows = 3, label = 'Loading',
}: {
  /** Tailwind width class per column, e.g. ['w-40','w-24']. */
  columns: string[];
  rows?: number;
  label?: string;
}) {
  return (
    <tbody>
      <tr>
        <td colSpan={columns.length} className="p-0">
          <span role="status" className="sr-only">{label}</span>
        </td>
      </tr>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} aria-hidden="true">
          {columns.map((w, c) => (
            <td key={c} className="px-4 py-3.5 border-b border-slate-100">
              <Skeleton className={cn('h-4', w)} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

/** Stand-in for a block of prose or a small panel body. */
export function BlockSkeleton({ lines = 3, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div>
      <span role="status" className="sr-only">{label}</span>
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={cn('h-4', i === lines - 1 ? 'w-1/2' : 'w-full')} />
        ))}
      </div>
    </div>
  );
}
