import { prisma } from '../../db/prisma.js';

/**
 * Penerima dihitung saat notifikasi dikirim dan selalu disaring ulang: user harus aktif dan
 * (untuk CS) masih punya akses ke brand. Pengawas holding (Admin/Finance/Superadmin) melihat semua brand.
 */
const brandAccess = (brandId: number) => ({ OR: [{ brandId }, { userBrands: { some: { brandId } } }] });

/** PIC prospek bila masih CS aktif dengan akses brand prospek. */
export async function picOf(prospect: { userId: number | null; brandId: number }) {
  if (!prospect.userId) return [];
  const user = await prisma.user.findFirst({
    where: { id: prospect.userId, isActive: true, role: 'cs', ...brandAccess(prospect.brandId) },
    select: { id: true },
  });
  return user ? [user.id] : [];
}

export async function csOfBrand(brandId: number) {
  const users = await prisma.user.findMany({ where: { isActive: true, role: 'cs', ...brandAccess(brandId) }, select: { id: true } });
  return users.map((u) => u.id);
}

export async function financeUsers() {
  const users = await prisma.user.findMany({ where: { isActive: true, role: 'finance' }, select: { id: true } });
  return users.map((u) => u.id);
}

/**
 * Admin yang terkait brand (brand utama atau penugasan) ditambah semua Superadmin.
 * Bila tidak ada Admin yang terkait, semua Admin aktif menerima agar notifikasi tidak hilang.
 */
export async function adminsOf(brandId: number) {
  const [linked, superadmins] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true, role: 'admin', ...brandAccess(brandId) }, select: { id: true } }),
    prisma.user.findMany({ where: { isActive: true, role: 'superadmin' }, select: { id: true } }),
  ]);
  const admins = linked.length
    ? linked
    : await prisma.user.findMany({ where: { isActive: true, role: 'admin' }, select: { id: true } });
  return [...admins, ...superadmins].map((u) => u.id);
}

/** Tim LA melayani semua brand holding. */
export async function productUsers() {
  const users = await prisma.user.findMany({ where: { isActive: true, role: 'product' }, select: { id: true } });
  return users.map((u) => u.id);
}

/** Finance aktif; bila belum ada, Admin brand + Superadmin (yang juga bisa memverifikasi) agar bukti tidak terlewat. */
export async function financeOrAdmins(brandId: number) {
  const finance = await financeUsers();
  return finance.length ? finance : adminsOf(brandId);
}

/** Tim LA aktif; bila belum ada, Superadmin (yang juga bisa menghitung harga custom). */
export async function productOrSuperadmins() {
  const product = await productUsers();
  if (product.length) return product;
  const superadmins = await prisma.user.findMany({ where: { isActive: true, role: 'superadmin' }, select: { id: true } });
  return superadmins.map((u) => u.id);
}
