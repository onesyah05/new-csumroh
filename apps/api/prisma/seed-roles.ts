import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { PrismaClient, type Role } from '@prisma/client';

/**
 * Akun uji per role untuk audit/QA end-to-end di mesin lokal. Tidak pernah dijalankan di production:
 * skrip menolak bila NODE_ENV=production atau DATABASE_URL bukan localhost. Kata sandi diambil dari
 * SEED_ROLE_PASSWORD di .env (sama untuk semua akun uji). Aman dijalankan berulang (upsert).
 */
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

function assertLocal() {
  if (process.env.NODE_ENV === 'production') throw new Error('seed-roles tidak boleh dijalankan di production.');
  const url = new URL((process.env.DATABASE_URL ?? '').replace(/^"|"$/g, ''));
  if (!LOCAL_HOSTS.includes(url.hostname)) throw new Error(`seed-roles hanya untuk database lokal (host saat ini: ${url.hostname}).`);
}

const ACCOUNTS: { email: string; name: string; role: Role; brand: 'primary' | null; extraBrands?: boolean }[] = [
  { email: 'admin.uji@crm.test', name: 'Admin Uji', role: 'admin', brand: 'primary' },
  { email: 'finance.uji@crm.test', name: 'Finance Uji', role: 'finance', brand: null },
  { email: 'timla.uji@crm.test', name: 'Tim LA Uji', role: 'product', brand: null },
  // CS yang memegang dua brand: menguji paket, inbox, dan pipeline lintas brand.
  { email: 'cs.multi.uji@crm.test', name: 'CS Multi-brand Uji', role: 'cs', brand: 'primary', extraBrands: true },
];

async function main() {
  assertLocal();
  const raw = process.env.SEED_ROLE_PASSWORD;
  if (!raw || raw.startsWith('change-me') || raw.length < 10) throw new Error('Isi SEED_ROLE_PASSWORD (min. 10 karakter) di .env.');
  const prisma = new PrismaClient();
  try {
    const brands = await prisma.brand.findMany({ orderBy: { id: 'asc' }, select: { id: true, code: true }, take: 2 });
    if (!brands.length) throw new Error('Belum ada brand. Buat brand dulu lewat aplikasi.');
    const password = await bcrypt.hash(raw, 12);
    for (const account of ACCOUNTS) {
      const brandId = account.brand === 'primary' ? brands[0]!.id : null;
      const user = await prisma.user.upsert({
        where: { email: account.email },
        update: { name: account.name, password, role: account.role, brandId, isActive: true },
        create: { email: account.email, name: account.name, password, role: account.role, brandId },
      });
      if (account.extraBrands) {
        for (const brand of brands) {
          await prisma.userBrand.upsert({
            where: { userId_brandId: { userId: user.id, brandId: brand.id } },
            update: {},
            create: { userId: user.id, brandId: brand.id },
          });
        }
      }
      console.log(`✓ ${account.role.padEnd(8)} ${account.email}${brandId ? ` · brand ${brands[0]!.code}` : ''}${account.extraBrands ? ` + ${brands.map((b) => b.code).join(', ')}` : ''}`);
    }
    console.log('Akun uji siap. Kata sandi: nilai SEED_ROLE_PASSWORD di .env.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
