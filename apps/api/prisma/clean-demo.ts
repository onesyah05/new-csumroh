import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const demoProspects = [
  { name: 'Nadia Azzahra', phone: '628121111111' },
  { name: 'Bpk. Abdullah', phone: '628122222222' },
  { name: 'Ibu Nurhayati', phone: '628123333333' },
  { name: 'H. Miftah', phone: '628124444444' },
  { name: 'Keluarga Rahman', phone: '628125555555' },
  { name: 'Ibu Salma', phone: '628126666666' },
  { name: 'Bpk. Fadli', phone: '628127777777' },
];

const demoUsers = [
  { email: process.env.SEED_ADMIN_EMAIL ?? 'brand-admin@example.com', name: 'Admin Hana' },
  { email: process.env.SEED_CS_EMAIL ?? 'cs@example.com', name: 'Fitri Rahma' },
  { email: process.env.SEED_CS2_EMAIL ?? 'cs2@example.com', name: 'Malik Akbar' },
];

async function main() {
  const demoBrands = await prisma.brand.findMany({
    where: { code: { in: ['HANA', 'NAVA'] } },
    select: { id: true, code: true },
  });
  const brandIds = demoBrands.map((brand) => brand.id);

  const result = await prisma.$transaction(async (tx) => {
    const messages = await tx.chatMessage.deleteMany({
      where: { brandId: { in: brandIds }, messageId: { startsWith: 'seed-' } },
    });
    const prospects = await tx.prospect.deleteMany({
      where: { brandId: { in: brandIds }, OR: demoProspects },
    });
    const packages = await tx.package.deleteMany({
      where: {
        brandId: { in: brandIds },
        name: { in: ['Umroh Awal Ramadan 1448H', 'Umroh Syawal Plus Thaif'] },
      },
    });
    const whatsapp = await tx.whatsappSession.deleteMany({
      where: { brandId: { in: brandIds }, phoneNumber: '628110000000' },
    });
    const users = await tx.user.deleteMany({ where: { OR: demoUsers } });

    const removedBrands: string[] = [];
    for (const brand of demoBrands) {
      const [userCount, packageCount, prospectCount, messageCount] = await Promise.all([
        tx.user.count({ where: { brandId: brand.id } }),
        tx.package.count({ where: { brandId: brand.id } }),
        tx.prospect.count({ where: { brandId: brand.id } }),
        tx.chatMessage.count({ where: { brandId: brand.id } }),
      ]);
      if (userCount + packageCount + prospectCount + messageCount === 0) {
        await tx.brand.delete({ where: { id: brand.id } });
        removedBrands.push(brand.code);
      }
    }

    return {
      messages: messages.count,
      prospects: prospects.count,
      packages: packages.count,
      whatsappSessions: whatsapp.count,
      users: users.count,
      brands: removedBrands,
    };
  });

  console.log(JSON.stringify({ success: true, removed: result }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
