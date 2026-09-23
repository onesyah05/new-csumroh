import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface StatCardProps {
  label: string;
  value: string | number;
  note?: string;
  icon?: ReactNode;
  valueColor?: string;
  alert?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  note,
  icon,
  valueColor,
  alert,
  className,
}: StatCardProps) {
  return (
    <div className={cn('surface rounded-xl border border-zinc-200/90 bg-white p-4 sm:p-5 shadow-2xs', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-500 block truncate">{label}</span>
        {icon && <span className="text-zinc-400 shrink-0">{icon}</span>}
      </div>
      <p
        className={cn(
          'mt-1 font-sans text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl tabular-nums leading-none',
          alert && !valueColor && 'text-amber-600',
          valueColor
        )}
      >
        {value}
      </p>
      {note && <p className="mt-1.5 text-xs text-zinc-400 truncate">{note}</p>}
    </div>
  );
}

export function StatGrid({
  children,
  cols = 4,
  className,
}: {
  children: ReactNode;
  cols?: 2 | 3 | 4;
  className?: string;
}) {
  const colClass = {
    2: 'grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-3',
    4: 'grid-cols-2 sm:grid-cols-4',
  }[cols];

  return (
    <section className={cn('grid gap-3.5', colClass, className)}>
      {children}
    </section>
  );
}
