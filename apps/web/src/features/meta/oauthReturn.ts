const REASONS: Record<string, string> = {
  denied: 'izin tidak diberikan.',
  expired: 'sesi kedaluwarsa, ulangi dari tab Meta brand.',
  unavailable: 'Meta App belum dikonfigurasi di server.',
  failed: 'lihat "Error terakhir dari Meta" di tab Meta brand.',
};

export const oauthFailureMessage = (reason: string | null) => `Gagal menghubungkan Meta: ${(reason && REASONS[reason]) || 'coba lagi.'}`;

/** Baca ?meta=connected|error&reason=... dari URL (hasil redirect callback) lalu bersihkan dari alamat. */
export function consumeOauthReturn(): { outcome: 'connected' | 'error'; reason: string | null } | null {
  const params = new URLSearchParams(window.location.search);
  const outcome = params.get('meta');
  if (outcome !== 'connected' && outcome !== 'error') return null;
  const reason = params.get('reason');
  params.delete('meta');
  params.delete('reason');
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  return { outcome, reason };
}
