import { prisma } from '../../db/prisma.js';
import { disconnectUser } from '../../realtime/socket.js';

/**
 * Waktu (detik penuh, ms) pencabutan sesi terakhir per user. Access token yang terbit sebelum waktu ini ditolak
 * `authGuard`/socket walau belum kedaluwarsa (sisa ≤15 menit). Disimpan di memori proses: setelah restart,
 * token lama tetap kedaluwarsa sendiri ≤15 menit dan refresh token-nya sudah dicabut di database.
 */
const revokedBefore = new Map<number, number>();

export function isTokenRevoked(userId: number, issuedAtSeconds: number | undefined) {
  const cutoff = revokedBefore.get(userId);
  return cutoff !== undefined && (issuedAtSeconds ?? 0) * 1000 < cutoff;
}

/**
 * Putus semua sesi user: refresh token dicabut (tanpa masa tenggang rotasi), access token yang sudah terbit
 * ditolak, dan socket realtime diputus. Dipakai saat akun dinonaktifkan/dihapus, kata sandi diganti, atau
 * role/akses brand berubah (klaim di token lama tidak lagi benar).
 */
export async function revokeUserSessions(userId: number) {
  const now = new Date();
  await prisma.refreshToken.updateMany({
    where: { userId, expiresAt: { gt: now } },
    data: { revokedAt: now, expiresAt: now },
  });
  revokedBefore.set(userId, Math.floor(now.getTime() / 1000) * 1000);
  disconnectUser(userId);
}
