import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
const prisma = new PrismaClient();

/**
 * Perbaikan data sekali jalan (audit pipeline 30 Sep 2026): prospek yang masih "Baru" padahal sudah pernah dibalas
 * dari nomor brand (dari CRM atau HP) dinaikkan ke "Terhubung", sama seperti yang kini dilakukan otomatis untuk
 * balasan baru. Tanpa --apply hanya menampilkan jumlahnya per brand.
 *
 *   pnpm --filter @csumroh/api db:backfill:contact            # lihat dulu
 *   pnpm --filter @csumroh/api db:backfill:contact -- --apply  # jalankan
 */
async function main() {
  const apply = process.argv.includes('--apply');
  const candidates = await prisma.prospect.findMany({
    where: {
      status: 'new',
      NOT: { remoteJid: { endsWith: '@g.us' } },
      messages: { some: { isFromMe: true } },
    },
    select: { id: true, brandId: true },
  });
  const brands = await prisma.brand.findMany({ select: { id: true, name: true } });
  const perBrand = new Map<number, number>();
  for (const p of candidates) perBrand.set(p.brandId, (perBrand.get(p.brandId) ?? 0) + 1);
  for (const [brandId, count] of perBrand) console.log(`${brands.find((b) => b.id === brandId)?.name ?? brandId}: ${count} prospek Baru → Terhubung`);
  console.log(`Total: ${candidates.length}`);
  if (!apply) {
    console.log('Belum ada yang diubah. Jalankan ulang dengan --apply untuk menerapkan.');
    return;
  }

  let changed = 0;
  for (let i = 0; i < candidates.length; i += 200) {
    const ids = candidates.slice(i, i + 200).map((p) => p.id);
    changed += await prisma.$transaction(async (tx) => {
      // Bersyarat status 'new': prospek yang sementara ini sudah dipindah CS tidak tersentuh.
      const moving = await tx.prospect.findMany({ where: { id: { in: ids }, status: 'new' }, select: { id: true } });
      if (!moving.length) return 0;
      await tx.prospect.updateMany({ where: { id: { in: moving.map((p) => p.id) }, status: 'new' }, data: { status: 'contact' } });
      await tx.prospectLog.createMany({
        data: moving.map((p) => ({
          prospectId: p.id,
          userId: null,
          actionType: 'status_changed',
          title: 'Status otomatis menjadi Terhubung (contact)',
          description: 'Perbaikan data: prospek sudah pernah dibalas dari nomor brand.',
        })),
      });
      return moving.length;
    });
  }
  console.log(`Diterapkan: ${changed} prospek menjadi Terhubung.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
