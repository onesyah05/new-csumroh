import { prisma } from '../../db/prisma.js';
import { normalizePhoneIdentifier } from './outbound.js';

/**
 * Kontak/percakapan terikat ke nomor WhatsApp (device) asalnya.
 * Hanya kontak milik device yang sedang tersambung yang tampil di Inbox, Pipeline, Kontak & Ringkasan.
 * Device terputus → daftar kosong; tersambung lagi dengan nomor yang sama → kontak muncul lagi (data tidak dihapus).
 * Finance & Laporan tidak memakai filter ini agar pembayaran/omzet tetap terlihat.
 */
export async function activeDevicePhone(brandId: number): Promise<string | null> {
  const session = await prisma.whatsappSession.findUnique({ where: { brandId }, select: { status: true, phoneNumber: true } });
  if (session?.status !== 'connected') return null;
  return normalizePhoneIdentifier(session.phoneNumber) || null;
}

/** Filter Prisma prospek per brand: hanya kontak device aktif; tanpa device aktif, tidak ada yang cocok. */
export async function visibleProspectWhere(brandIds: number[]) {
  const phones = await Promise.all(brandIds.map(async (brandId) => ({ brandId, devicePhone: await activeDevicePhone(brandId) })));
  const active = phones.filter((item): item is { brandId: number; devicePhone: string } => Boolean(item.devicePhone));
  return active.length ? { OR: active } : { id: -1 };
}

/**
 * Device baru tersambung: prospek brand yang belum punya device (data lama sebelum kolom ini ada,
 * atau kontak manual yang didaftarkan saat device terputus) diikat ke nomor ini.
 */
export async function adoptUnassignedProspects(brandId: number, phoneNumber?: string | null) {
  const devicePhone = normalizePhoneIdentifier(phoneNumber);
  if (!devicePhone) return 0;
  const { count } = await prisma.prospect.updateMany({ where: { brandId, devicePhone: null }, data: { devicePhone } });
  return count;
}
