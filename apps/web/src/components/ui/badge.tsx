import { isLostStatus, isWonStatus } from '@csumroh/shared-types';
import { StatusBadge, type StatusBadgeVariant } from './status-badge';

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

/**
 * Badge status prospek. Satu komponen dasar dengan StatusBadge; warna mengikuti aturan AGENTS §3:
 * Deal hijau solid, tahap berjalan bergaris hitam, Baru abu, Batal abu dicoret.
 */
export function Badge({ value, className }: { value: string; className?: string }) {
  const status: StatusBadgeVariant = isWonStatus(value)
    ? 'deal'
    : isLostStatus(value)
      ? 'lost'
      : value === 'new'
        ? 'neutral'
        : 'progress';
  return <StatusBadge status={status} label={statusLabels[value] ?? value} dot className={className} />;
}
