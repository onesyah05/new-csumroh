import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type StatusBadgeVariant =
  | 'active'
  | 'archived'
  | 'promo'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  // Status prospek (AGENTS §3): Deal hijau solid, tahap berjalan bergaris hitam, Batal abu dicoret.
  | 'deal'
  | 'progress'
  | 'lost';

export interface StatusBadgeProps {
  status?: StatusBadgeVariant;
  label: ReactNode;
  dot?: boolean;
  icon?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}

export function StatusBadge({
  status = 'neutral',
  label,
  dot = false,
  icon,
  size = 'md',
  className,
}: StatusBadgeProps) {
  const variantStyles: Record<StatusBadgeVariant, { wrapper: string; dot: string }> = {
    active: {
      wrapper: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      dot: 'bg-emerald-500',
    },
    archived: {
      wrapper: 'border-zinc-200 bg-zinc-100 text-zinc-500',
      dot: 'bg-zinc-400',
    },
    promo: {
      wrapper: 'border-amber-200 bg-amber-50 text-amber-800',
      dot: 'bg-amber-500',
    },
    warning: {
      wrapper: 'border-amber-200 bg-amber-50 text-amber-800',
      dot: 'bg-amber-500',
    },
    danger: {
      wrapper: 'border-rose-200 bg-rose-50 text-rose-700',
      dot: 'bg-rose-500',
    },
    info: {
      wrapper: 'border-zinc-300 bg-white text-zinc-700',
      dot: 'bg-zinc-500',
    },
    neutral: {
      wrapper: 'border-zinc-200 bg-zinc-100 text-zinc-700',
      dot: 'bg-zinc-400',
    },
    deal: {
      wrapper: 'border-emerald-600 bg-emerald-600 text-white',
      dot: 'bg-white',
    },
    progress: {
      wrapper: 'border-zinc-800 bg-white text-zinc-900',
      dot: 'bg-zinc-800',
    },
    lost: {
      wrapper: 'border-zinc-200 bg-zinc-200 text-zinc-600 line-through',
      dot: 'bg-zinc-500',
    },
  };

  const style = variantStyles[status] || variantStyles.neutral;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-semibold select-none shadow-2xs',
        // Label status adalah teks yang dibaca: minimal 12 px di kedua ukuran.
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-0.5 text-xs',
        style.wrapper,
        className
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', style.dot)} />}
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{label}</span>
    </span>
  );
}
