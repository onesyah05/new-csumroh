import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { emitToBrand } from '../../realtime/socket.js';
import { HttpError } from '../../utils/http.js';
import { normalizePhoneIdentifier } from '../chat/outbound.js';
import { dispatch, notifyProspectsReleased } from '../notifications/notification.events.js';

type Db = Prisma.TransactionClient | typeof prisma;
type Actor = { id: number; role: string; name?: string };

export const MANAGER_ROLES = ['admin', 'superadmin'];
/** Status yang tidak lagi dikerjakan CS: tidak dihitung sebagai beban dan tidak bisa diklaim. */
export const CLOSED_STATUSES = ['deal', 'closed_won', 'lose', 'closed_lost'] as const;

export const isManager = (role?: string) => MANAGER_ROLES.includes(role ?? '');
export const isClosedStatus = (status?: string | null) => (CLOSED_STATUSES as readonly string[]).includes(status ?? '');

/**
 * Siapa yang boleh mengubah prospek: Admin/Superadmin selalu; CS bila ia PIC atau prospek belum ber-PIC
 * (sama dengan aturan membalas chat); Finance hanya pada tindakan yang memang bagian tugasnya.
 */
export function canActOnProspect(user: Actor, prospect: { userId: number | null }, options: { finance?: boolean } = {}) {
  if (isManager(user.role)) return true;
  if (user.role === 'finance') return Boolean(options.finance);
  if (user.role !== 'cs') return false;
  return prospect.userId === null || prospect.userId === user.id;
}

export async function assertCanActOnProspect(
  user: Actor,
  prospect: { userId: number | null },
  options: { finance?: boolean } = {},
) {
  if (canActOnProspect(user, prospect, options)) return;
  if (user.role === 'finance') {
    throw new HttpError(403, 'Finance hanya menangani bukti dan verifikasi pembayaran awal.');
  }
  const pic = prospect.userId
    ? await prisma.user.findUnique({ where: { id: prospect.userId }, select: { name: true } })
    : null;
  throw new HttpError(403, `Hanya PIC${pic?.name ? ` (${pic.name})` : ''} atau Admin yang dapat mengubah prospek ini.`);
}

/**
 * Satu nomor WhatsApp bisa tersimpan sebagai beberapa record (jid lama, @lid, format 0/62).
 * Penugasan PIC diterapkan ke semuanya agar tidak ada duplikat dengan PIC berbeda.
 */
export async function linkedProspectIds(db: Db, prospect: { id: number; brandId: number; phone?: string | null; remoteJid?: string | null }) {
  if (prospect.remoteJid?.endsWith('@g.us')) return [prospect.id];
  const phone = normalizePhoneIdentifier(prospect.phone) || normalizePhoneIdentifier(prospect.remoteJid);
  const aliases = phone ? [...new Set([phone, `+${phone}`, phone.startsWith('62') ? `0${phone.slice(2)}` : phone])] : [];
  const or: Prisma.ProspectWhereInput[] = [];
  if (prospect.remoteJid) or.push({ remoteJid: prospect.remoteJid });
  if (aliases.length) or.push({ phone: { in: aliases } }, { remoteJid: `${phone}@s.whatsapp.net` });
  if (!or.length) return [prospect.id];
  const rows = await db.prospect.findMany({ where: { brandId: prospect.brandId, OR: or }, select: { id: true } });
  return [...new Set([prospect.id, ...rows.map((r) => r.id)])];
}

/** CS aktif yang boleh menjadi PIC brand ini (brand utama atau akses tambahan) beserta beban prospek terbukanya. */
export async function picCandidates(brandId: number, db: Db = prisma) {
  const users = await db.user.findMany({
    where: { isActive: true, role: 'cs', OR: [{ brandId }, { userBrands: { some: { brandId } } }] },
    select: {
      id: true,
      name: true,
      _count: { select: { prospects: { where: { brandId, status: { notIn: [...CLOSED_STATUSES] } } } } },
    },
    orderBy: { id: 'asc' },
  });
  return users.map((u) => ({ id: u.id, name: u.name, openProspects: u._count.prospects }));
}

/** Lead baru diberikan ke CS dengan prospek terbuka paling sedikit di brand ini; seri dipecah oleh id terkecil. */
export async function pickAutoAssignee(brandId: number, db: Db = prisma) {
  const candidates = await picCandidates(brandId, db);
  return candidates.sort((a, b) => a.openProspects - b.openProspects || a.id - b.id)[0] ?? null;
}

/**
 * Lepas PIC milik CS yang tidak lagi bisa menangani brand tertentu (dinonaktifkan, dihapus, ganti role,
 * atau akses brand dicabut). Prospek terbuka kembali ke antrean "Belum ada PIC" dan tercatat di riwayat.
 * `brandIds` kosong berarti semua brand.
 */
export async function releaseProspectsOf(
  userId: number,
  options: { actor: Actor & { name: string }; reason: string; keepBrandIds?: number[] },
) {
  const where: Prisma.ProspectWhereInput = {
    userId,
    status: { notIn: [...CLOSED_STATUSES] },
    ...(options.keepBrandIds?.length ? { brandId: { notIn: options.keepBrandIds } } : {}),
  };
  const rows = await prisma.prospect.findMany({ where, select: { id: true, brandId: true } });
  if (!rows.length) return 0;
  await prisma.$transaction(async (tx) => {
    await tx.prospect.updateMany({ where: { id: { in: rows.map((r) => r.id) }, userId }, data: { userId: null } });
    await tx.prospectLog.createMany({
      data: rows.map((r) => ({
        prospectId: r.id,
        userId: options.actor.id,
        actionType: 'pic_released',
        title: `PIC dilepas ke antrean: ${options.reason}`,
        description: `Oleh: ${options.actor.name} (${options.actor.role})`,
      })),
    });
  });
  for (const brandId of new Set(rows.map((r) => r.brandId))) {
    emitToBrand(brandId, 'prospect:claimed', { prospectIds: rows.filter((r) => r.brandId === brandId).map((r) => r.id), userId: null });
  }
  dispatch(() => notifyProspectsReleased(rows, options.actor, options.reason));
  return rows.length;
}
