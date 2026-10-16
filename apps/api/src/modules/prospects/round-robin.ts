import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../utils/http.js';

export const ROUND_ROBIN_TOTAL = 100;

type Share = { userId: number; percent: number; assignedCount: number };

/**
 * CS berikutnya = yang paling tertinggal dari jatahnya: persen × (jumlah terbagi + 1) − terbagi × total persen.
 * Deterministik (bukan acak): 50/30/20 membagi tiap 10 prospek tepat 5/3/2. Seri dimenangkan userId terkecil.
 */
export function pickRoundRobinUser(shares: Share[]): number | null {
  const active = shares.filter((s) => s.percent > 0);
  if (!active.length) return null;
  const total = active.reduce((sum, s) => sum + s.percent, 0);
  const next = active.reduce((sum, s) => sum + s.assignedCount, 0) + 1;
  let best: { userId: number; deficit: number } | null = null;
  for (const s of [...active].sort((a, b) => a.userId - b.userId)) {
    const deficit = s.percent * next - s.assignedCount * total;
    if (!best || deficit > best.deficit) best = { userId: s.userId, deficit };
  }
  return best?.userId ?? null;
}

const eligibleUser = (brandId: number): Prisma.UserWhereInput => ({
  isActive: true,
  role: 'cs',
  OR: [{ brandId }, { userBrands: { some: { brandId } } }],
});

/** Kunci baris brand: pembagian dan penyimpanan setelan untuk brand ini berjalan satu per satu. */
const lockBrand = (tx: Prisma.TransactionClient, brandId: number) => tx.$queryRaw`SELECT id FROM brands WHERE id = ${brandId} FOR UPDATE`;

/** Pilih CS berikutnya dan naikkan counter-nya; null bila fitur mati atau tak ada CS layak (perilaku lama: tanpa PIC). */
export async function claimRoundRobinPic(tx: Prisma.TransactionClient, brandId: number) {
  await lockBrand(tx, brandId);
  const brand = await tx.brand.findUnique({ where: { id: brandId }, select: { roundRobinEnabled: true } });
  if (!brand?.roundRobinEnabled) return null;
  const rows = await tx.roundRobinShare.findMany({
    where: { brandId, percent: { gt: 0 }, user: eligibleUser(brandId) },
    select: { userId: true, percent: true, assignedCount: true, user: { select: { name: true } } },
    orderBy: { userId: 'asc' },
  });
  const userId = pickRoundRobinUser(rows);
  if (userId === null) return null;
  await tx.roundRobinShare.update({ where: { brandId_userId: { brandId, userId } }, data: { assignedCount: { increment: 1 } } });
  return { userId, name: rows.find((r) => r.userId === userId)?.user.name ?? '' };
}

/** Buat prospek baru; bila round robin brand aktif, PIC langsung terisi dan tercatat di riwayat prospek. */
export async function createProspectWithRoundRobin(brandId: number, data: Omit<Prisma.ProspectUncheckedCreateInput, 'brandId' | 'userId'>) {
  const flag = await prisma.brand.findUnique({ where: { id: brandId }, select: { roundRobinEnabled: true } });
  if (!flag?.roundRobinEnabled) return { prospect: await prisma.prospect.create({ data: { ...data, brandId, userId: null } }), assigned: null };
  return prisma.$transaction(async (tx) => {
    const assigned = await claimRoundRobinPic(tx, brandId);
    const prospect = await tx.prospect.create({ data: { ...data, brandId, userId: assigned?.userId ?? null } });
    if (assigned) {
      await tx.prospectLog.create({
        data: {
          prospectId: prospect.id,
          // Tanpa pelaku: dibagi sistem, bukan tindakan CS itu sendiri.
          userId: null,
          actionType: 'pic_auto_assigned',
          title: `PIC dibagi otomatis (round robin): ${assigned.name}`,
        },
      });
    }
    return { prospect, assigned };
  });
}

export type RoundRobinMember = { userId: number; name: string; percent: number; assignedCount: number };

export async function getRoundRobinSettings(brandId: number) {
  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { roundRobinEnabled: true } });
  if (!brand) throw new HttpError(404, 'Brand tidak ditemukan.');
  const users = await prisma.user.findMany({
    where: eligibleUser(brandId),
    select: { id: true, name: true, roundRobinShares: { where: { brandId }, select: { percent: true, assignedCount: true } } },
    orderBy: { id: 'asc' },
  });
  const members: RoundRobinMember[] = users.map((u) => ({
    userId: u.id,
    name: u.name,
    percent: u.roundRobinShares[0]?.percent ?? 0,
    assignedCount: u.roundRobinShares[0]?.assignedCount ?? 0,
  }));
  return { enabled: brand.roundRobinEnabled, total: members.reduce((sum, m) => sum + m.percent, 0), members };
}

/** Simpan setelan. Setiap simpan mengulang hitungan (counter 0) supaya porsi baru langsung berlaku. */
export async function saveRoundRobinSettings(brandId: number, input: { enabled: boolean; shares: { userId: number; percent: number }[] }) {
  const ids = input.shares.map((s) => s.userId);
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'CS tidak boleh muncul dua kali.');
  const total = input.shares.reduce((sum, s) => sum + s.percent, 0);
  if (input.enabled && total !== ROUND_ROBIN_TOTAL) throw new HttpError(400, `Total persen harus 100% (sekarang ${total}%).`);
  if (total > ROUND_ROBIN_TOTAL) throw new HttpError(400, `Total persen tidak boleh melebihi 100% (sekarang ${total}%).`);
  await prisma.$transaction(async (tx) => {
    await lockBrand(tx, brandId);
    // Kelayakan dicek di dalam transaksi: CS yang baru dinonaktifkan/dicabut tidak lolos ke penyimpanan.
    const eligible = await tx.user.findMany({ where: { ...eligibleUser(brandId), id: { in: ids } }, select: { id: true } });
    if (eligible.length !== ids.length) throw new HttpError(400, 'Ada CS yang tidak aktif atau tidak terhubung ke brand ini.');
    await tx.brand.update({ where: { id: brandId }, data: { roundRobinEnabled: input.enabled } });
    await tx.roundRobinShare.updateMany({ where: { brandId }, data: { assignedCount: 0 } });
    for (const s of input.shares) {
      await tx.roundRobinShare.upsert({
        where: { brandId_userId: { brandId, userId: s.userId } },
        create: { brandId, userId: s.userId, percent: s.percent, assignedCount: 0 },
        update: { percent: s.percent, assignedCount: 0 },
      });
    }
    // CS yang tidak lagi ada di daftar (dinonaktifkan/dicabut) tidak boleh mempertahankan jatah lama.
    await tx.roundRobinShare.updateMany({ where: { brandId, userId: { notIn: ids } }, data: { percent: 0 } });
  });
  return getRoundRobinSettings(brandId);
}
