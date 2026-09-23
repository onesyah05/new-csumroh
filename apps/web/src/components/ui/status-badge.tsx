import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type StatusBadgeVariant =
  | 'active'
  | 'archived'
  | 'promo'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral';

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
      wrapper: 'border-sky-200 bg-sky-50 text-sky-800',
      dot: 'bg-sky-500',
    },
    neutral: {
      wrapper: 'border-zinc-200 bg-zinc-50 text-zinc-700',
      dot: 'bg-zinc-400',
    },
  };

  const style = variantStyles[status] || variantStyles.neutral;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-semibold select-none shadow-2xs',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-[11px]',
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
