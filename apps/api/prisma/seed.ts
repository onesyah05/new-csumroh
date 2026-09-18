import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

function required(name: string) {
  const value = process.env[name];
  if (!value || value.startsWith('change-me')) {
    throw new Error(`${name} wajib diisi dengan nilai aman di .env sebelum bootstrap.`);
  }
  return value;
}

async function main() {
  const email = process.env.SEED_SUPERADMIN_EMAIL ?? 'owner@example.com';
  const name = process.env.SEED_SUPERADMIN_NAME ?? 'Super Admin';
  const password = await bcrypt.hash(required('SEED_SUPERADMIN_PASSWORD'), 12);

  await prisma.user.upsert({
    where: { email },
    update: { name, password, role: 'superadmin', brandId: null, isActive: true },
    create: { name, email, password, role: 'superadmin' },
  });

  console.log(`Bootstrap selesai: superadmin ${email} siap. Data operasional tidak dibuat oleh seed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
