import { beforeEach, describe, expect, it, vi } from 'vitest';

const users = vi.hoisted(() => ({ list: [] as { id: number; role: string; brandId: number | null }[] }));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    user: {
      findMany: async ({ where }: { where: { role: string; OR?: unknown } }) =>
        users.list.filter((u) => u.role === where.role && (!where.OR || u.brandId === 1)).map((u) => ({ id: u.id })),
    },
  },
}));

import { adminsOf, financeOrAdmins, productOrSuperadmins } from './recipients.js';

beforeEach(() => { users.list = []; });

describe('penerima cadangan', () => {
  it('bukti transfer: ke Finance; tanpa Finance aktif ke Admin brand + Superadmin', async () => {
    users.list = [{ id: 1, role: 'superadmin', brandId: null }, { id: 4, role: 'admin', brandId: 1 }, { id: 3, role: 'finance', brandId: null }];
    expect(await financeOrAdmins(1)).toEqual([3]);
    users.list = users.list.filter((u) => u.role !== 'finance');
    expect((await financeOrAdmins(1)).sort()).toEqual([1, 4]);
  });

  it('Admin brand lain tidak menerima notifikasi brand yang tidak ia pegang', async () => {
    // Brand 1 tanpa Admin terkait; Admin id 5 hanya memegang brand 2.
    users.list = [{ id: 1, role: 'superadmin', brandId: null }, { id: 5, role: 'admin', brandId: 2 }];
    expect(await adminsOf(1)).toEqual([1]);
    // Tanpa Superadmin sama sekali: cadangan ke semua Admin agar tidak hilang.
    users.list = [{ id: 5, role: 'admin', brandId: 2 }];
    expect(await adminsOf(1)).toEqual([5]);
  });

  it('layanan custom: ke Tim LA; tanpa Tim LA aktif ke Superadmin', async () => {
    users.list = [{ id: 1, role: 'superadmin', brandId: null }, { id: 9, role: 'product', brandId: null }];
    expect(await productOrSuperadmins()).toEqual([9]);
    users.list = users.list.filter((u) => u.role !== 'product');
    expect(await productOrSuperadmins()).toEqual([1]);
  });
});
