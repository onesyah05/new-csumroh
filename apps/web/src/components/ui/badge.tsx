import { isLostStatus, isWonStatus, PROSPECT_STATUS_LABELS } from '@csumroh/shared-types';
import { StatusBadge, type StatusBadgeVariant } from './status-badge';

/** Label tahap baku; sumbernya di shared-types agar sama dengan yang dipakai API (mis. prompt Asisten AI). */
export const statusLabels = PROSPECT_STATUS_LABELS;

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
