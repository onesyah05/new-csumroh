/**
 * Enkripsi ulang rahasia tersimpan (token Meta, kunci API AI) dengan kunci aktif setelah rotasi.
 *
 * Rotasi: isi META_TOKEN_ENCRYPTION_KEY dengan kunci baru, pindahkan kunci lama ke META_TOKEN_ENCRYPTION_KEY_PREVIOUS,
 * lalu jalankan skrip ini. Setelah semuanya berformat enc:v2 dengan id kunci baru, kunci lama boleh dihapus.
 *
 * Pakai --dry-run untuk melihat jumlah yang akan diubah tanpa menulis.
 */
import { prisma } from '../src/db/prisma.js';
import { decryptSecret, encryptSecret, isCurrentlyEncrypted } from '../src/modules/capi/meta-token.js';

const dryRun = process.argv.includes('--dry-run');
let changed = 0;
let failed = 0;

async function convert(label: string, value: string | null, save: (next: string) => Promise<unknown>) {
  if (!value || isCurrentlyEncrypted(value)) return;
  try {
    const next = encryptSecret(decryptSecret(value));
    if (!dryRun) await save(next);
    changed += 1;
  } catch (error) {
    failed += 1;
    console.error(`Gagal membaca ${label}: ${(error as Error).message}`);
  }
}

const brands = await prisma.brand.findMany({ select: { id: true, metaAccessToken: true, metaAdsAccessToken: true } });
for (const brand of brands) {
  await convert(`brand ${brand.id} (token CAPI)`, brand.metaAccessToken, (next) => prisma.brand.update({ where: { id: brand.id }, data: { metaAccessToken: next } }));
  await convert(`brand ${brand.id} (token iklan)`, brand.metaAdsAccessToken, (next) => prisma.brand.update({ where: { id: brand.id }, data: { metaAdsAccessToken: next } }));
}
const ai = await prisma.aiSetting.findUnique({ where: { id: 1 }, select: { apiKey: true } });
await convert('kunci API AI', ai?.apiKey ?? null, (next) => prisma.aiSetting.update({ where: { id: 1 }, data: { apiKey: next } }));

console.log(`${dryRun ? '[dry-run] ' : ''}Dienkripsi ulang: ${changed}. Gagal dibaca: ${failed}.`);
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
