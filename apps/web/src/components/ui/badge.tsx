import { cn } from '../../lib/cn';

export const statusLabels: Record<string, string> = {
  new: 'Baru',
  contact: 'Terhubung',
  identifying: 'Terhubung',
  qualified: 'Terkualifikasi',
  offer: 'Ditawarkan',
  offered: 'Ditawarkan',
  objection: 'Keberatan',
  followup: 'Follow-up',
  closing: 'Tunggu Verifikasi',
  deal: 'Deal',
  closed_won: 'Deal',
  lose: 'Batal',
  closed_lost: 'Batal',
  nurture: 'Nurture',
};

export function Badge({ value, className }: { value: string; className?: string }) {
  const getVariant = (val: string) => {
    switch (val) {
      case 'deal':
      case 'closed_won':
        return {
          wrapper: 'border-emerald-200 bg-emerald-50/80 text-emerald-800 font-semibold',
          dot: 'bg-emerald-500',
        };
      case 'lose':
      case 'closed_lost':
        return {
          wrapper: 'border-zinc-200 bg-zinc-100 text-zinc-400 line-through',
          dot: 'bg-zinc-400',
        };
      case 'closing':
        return {
          wrapper: 'border-blue-200 bg-blue-50/80 text-blue-800 font-semibold',
          dot: 'bg-blue-500',
        };
      case 'objection':
        return {
          wrapper: 'border-amber-200 bg-amber-50/80 text-amber-800 font-semibold',
          dot: 'bg-amber-500',
        };
      case 'followup':
        return {
          wrapper: 'border-sky-200 bg-sky-50/80 text-sky-800 font-semibold',
          dot: 'bg-sky-500',
        };
      case 'offer':
      case 'offered':
        return {
          wrapper: 'border-indigo-200 bg-indigo-50/80 text-indigo-800 font-semibold',
          dot: 'bg-indigo-500',
        };
      case 'qualified':
        return {
          wrapper: 'border-purple-200 bg-purple-50/80 text-purple-800 font-semibold',
          dot: 'bg-purple-500',
        };
      case 'contact':
      case 'identifying':
        return {
          wrapper: 'border-teal-200 bg-teal-50/80 text-teal-800 font-semibold',
          dot: 'bg-teal-500',
        };
      default:
        return {
          wrapper: 'border-zinc-200 bg-zinc-50 text-zinc-700',
          dot: 'bg-zinc-400',
        };
    }
  };

  const config = getVariant(value);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-tight shadow-2xs',
        config.wrapper,
        className
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', config.dot)} />
      <span>{statusLabels[value] ?? value}</span>
    </span>
  );
}

