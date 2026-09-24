import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  prospectFindMany: vi.fn(),
  prospectUpdateMany: vi.fn(),
  logCreateMany: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('../../db/prisma.js', () => {
  const client: any = {
    user: { findMany: mocks.userFindMany, findUnique: vi.fn() },
    prospect: { findMany: mocks.prospectFindMany, updateMany: mocks.prospectUpdateMany },
    prospectLog: { createMany: mocks.logCreateMany },
  };
  client.$transaction = (cb: any) => cb(client);
  return { prisma: client };
});
vi.mock('../../realtime/socket.js', () => ({ emitToBrand: mocks.emit }));

import { canActOnProspect, pickAutoAssignee, releaseProspectsOf } from './pic.js';

beforeEach(() => vi.clearAllMocks());

describe('canActOnProspect', () => {
  it('Admin selalu; CS bila PIC atau tanpa PIC; Finance hanya bila diizinkan', () => {
    expect(canActOnProspect({ id: 1, role: 'admin' }, { userId: 5 })).toBe(true);
    expect(canActOnProspect({ id: 5, role: 'cs' }, { userId: 5 })).toBe(true);
    expect(canActOnProspect({ id: 6, role: 'cs' }, { userId: null })).toBe(true);
    expect(canActOnProspect({ id: 6, role: 'cs' }, { userId: 5 })).toBe(false);
    expect(canActOnProspect({ id: 9, role: 'finance' }, { userId: 5 })).toBe(false);
    expect(canActOnProspect({ id: 9, role: 'finance' }, { userId: 5 }, { finance: true })).toBe(true);
  });
});

describe('pickAutoAssignee', () => {
  it('memilih CS dengan prospek terbuka paling sedikit di brand ini, termasuk CS multi-brand', async () => {
    mocks.userFindMany.mockResolvedValue([
      { id: 3, name: 'Busy', _count: { prospects: 12 } },
      { id: 4, name: 'Multi-brand', _count: { prospects: 2 } },
      { id: 2, name: 'Also two', _count: { prospects: 2 } },
    ]);
    expect(await pickAutoAssignee(1)).toMatchObject({ id: 2 });
    const query = mocks.userFindMany.mock.calls[0][0];
    expect(query.where.OR).toEqual([{ brandId: 1 }, { userBrands: { some: { brandId: 1 } } }]);
    // Deal/Batal (status baru dan lama) bukan beban; hitungan per brand.
    expect(query.select._count.select.prospects.where).toEqual({
      brandId: 1,
      status: { notIn: ['deal', 'closed_won', 'lose', 'closed_lost'] },
    });
  });

  it('tanpa CS aktif, lead masuk antrean', async () => {
    mocks.userFindMany.mockResolvedValue([]);
    expect(await pickAutoAssignee(1)).toBeNull();
  });
});

describe('releaseProspectsOf', () => {
  it('melepas prospek terbuka ke antrean dengan log per prospek dan event per brand', async () => {
    mocks.prospectFindMany.mockResolvedValue([{ id: 10, brandId: 1 }, { id: 11, brandId: 2 }]);
    const count = await releaseProspectsOf(5, { actor: { id: 1, name: 'Admin', role: 'admin' }, reason: 'CS dinonaktifkan' });
    expect(count).toBe(2);
    expect(mocks.prospectUpdateMany).toHaveBeenCalledWith({ where: { id: { in: [10, 11] }, userId: 5 }, data: { userId: null } });
    expect(mocks.logCreateMany.mock.calls[0][0].data).toHaveLength(2);
    expect(mocks.emit).toHaveBeenCalledTimes(2);
  });

  it('hanya brand yang aksesnya dicabut', async () => {
    mocks.prospectFindMany.mockResolvedValue([]);
    await releaseProspectsOf(5, { actor: { id: 1, name: 'Admin', role: 'admin' }, reason: 'akses dicabut', keepBrandIds: [1] });
    expect(mocks.prospectFindMany.mock.calls[0][0].where).toMatchObject({ userId: 5, brandId: { notIn: [1] } });
    expect(mocks.prospectUpdateMany).not.toHaveBeenCalled();
  });
});
