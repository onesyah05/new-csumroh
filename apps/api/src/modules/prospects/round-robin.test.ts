import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  brandFind: vi.fn(),
  brandUpdate: vi.fn(),
  shareFindMany: vi.fn(),
  shareUpdate: vi.fn(),
  shareUpdateMany: vi.fn(),
  shareUpsert: vi.fn(),
  userFindMany: vi.fn(),
  prospectCreate: vi.fn(),
  logCreate: vi.fn(),
}));

vi.mock('../../db/prisma.js', () => {
  const client: any = {
    $queryRaw: mocks.queryRaw,
    brand: { findUnique: mocks.brandFind, update: mocks.brandUpdate },
    roundRobinShare: { findMany: mocks.shareFindMany, update: mocks.shareUpdate, updateMany: mocks.shareUpdateMany, upsert: mocks.shareUpsert },
    user: { findMany: mocks.userFindMany },
    prospect: { create: mocks.prospectCreate },
    prospectLog: { create: mocks.logCreate },
  };
  client.$transaction = (cb: any) => cb(client);
  return { prisma: client };
});

import { createProspectWithRoundRobin, pickRoundRobinUser, saveRoundRobinSettings } from './round-robin.js';

beforeEach(() => vi.resetAllMocks());

describe('pickRoundRobinUser', () => {
  it('membagi tepat sesuai porsi: 50/30/20 → tiap 10 prospek 5/3/2', () => {
    const shares = [{ userId: 1, percent: 50, assignedCount: 0 }, { userId: 2, percent: 30, assignedCount: 0 }, { userId: 3, percent: 20, assignedCount: 0 }];
    const tally: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
    for (let i = 0; i < 10; i += 1) {
      const id = pickRoundRobinUser(shares)!;
      tally[id] += 1;
      shares.find((s) => s.userId === id)!.assignedCount += 1;
    }
    expect(tally).toEqual({ 1: 5, 2: 3, 3: 2 });
  });

  it('porsi sama: bergiliran, seri dimenangkan userId terkecil', () => {
    const shares = [{ userId: 7, percent: 50, assignedCount: 0 }, { userId: 4, percent: 50, assignedCount: 0 }];
    const order: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const id = pickRoundRobinUser(shares)!;
      order.push(id);
      shares.find((s) => s.userId === id)!.assignedCount += 1;
    }
    expect(order).toEqual([4, 7, 4, 7]);
  });

  it('CS yang tertinggal mengejar setelah persen diubah tanpa mengabaikan yang lain', () => {
    expect(pickRoundRobinUser([{ userId: 1, percent: 70, assignedCount: 9 }, { userId: 2, percent: 30, assignedCount: 1 }])).toBe(2);
  });

  it('persen 0 dilewati; tanpa peserta menghasilkan null', () => {
    expect(pickRoundRobinUser([{ userId: 1, percent: 0, assignedCount: 0 }, { userId: 2, percent: 100, assignedCount: 3 }])).toBe(2);
    expect(pickRoundRobinUser([{ userId: 1, percent: 0, assignedCount: 0 }])).toBeNull();
    expect(pickRoundRobinUser([])).toBeNull();
  });
});

describe('createProspectWithRoundRobin', () => {
  const data = { name: 'Bu Aisyah', phone: '628111' } as any;

  it('fitur mati: prospek dibuat tanpa PIC dan tanpa transaksi/log', async () => {
    mocks.brandFind.mockResolvedValue({ roundRobinEnabled: false });
    mocks.prospectCreate.mockResolvedValue({ id: 1 });
    const result = await createProspectWithRoundRobin(3, data);
    expect(result.assigned).toBeNull();
    expect(mocks.prospectCreate).toHaveBeenCalledWith({ data: { ...data, brandId: 3, userId: null } });
    expect(mocks.logCreate).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('fitur aktif: kunci brand, pilih CS, naikkan counter, buat prospek dengan PIC, tulis log', async () => {
    mocks.brandFind.mockResolvedValue({ roundRobinEnabled: true });
    mocks.shareFindMany.mockResolvedValue([
      { userId: 5, percent: 60, assignedCount: 3, user: { name: 'Nisa' } },
      { userId: 6, percent: 40, assignedCount: 0, user: { name: 'Rafi' } },
    ]);
    mocks.prospectCreate.mockResolvedValue({ id: 9 });
    const result = await createProspectWithRoundRobin(3, data);
    expect(result.assigned).toEqual({ userId: 6, name: 'Rafi' });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.shareUpdate).toHaveBeenCalledWith({ where: { brandId_userId: { brandId: 3, userId: 6 } }, data: { assignedCount: { increment: 1 } } });
    expect(mocks.prospectCreate).toHaveBeenCalledWith({ data: { ...data, brandId: 3, userId: 6 } });
    expect(mocks.logCreate.mock.calls[0][0].data).toMatchObject({ prospectId: 9, actionType: 'pic_auto_assigned', userId: 6 });
  });

  it('tak ada CS layak: prospek tetap tanpa PIC (perilaku lama)', async () => {
    mocks.brandFind.mockResolvedValue({ roundRobinEnabled: true });
    mocks.shareFindMany.mockResolvedValue([]);
    mocks.prospectCreate.mockResolvedValue({ id: 10 });
    const result = await createProspectWithRoundRobin(3, data);
    expect(result.assigned).toBeNull();
    expect(mocks.prospectCreate).toHaveBeenCalledWith({ data: { ...data, brandId: 3, userId: null } });
    expect(mocks.shareUpdate).not.toHaveBeenCalled();
    expect(mocks.logCreate).not.toHaveBeenCalled();
  });
});

describe('saveRoundRobinSettings', () => {
  it('menolak total ≠ 100 saat diaktifkan', async () => {
    mocks.userFindMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    await expect(saveRoundRobinSettings(3, { enabled: true, shares: [{ userId: 1, percent: 60 }, { userId: 2, percent: 30 }] })).rejects.toThrow('Total persen harus 100% (sekarang 90%)');
    expect(mocks.brandUpdate).not.toHaveBeenCalled();
  });

  it('menolak total di atas 100 walau belum diaktifkan, dan CS ganda', async () => {
    mocks.userFindMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    await expect(saveRoundRobinSettings(3, { enabled: false, shares: [{ userId: 1, percent: 80 }, { userId: 2, percent: 40 }] })).rejects.toThrow('tidak boleh melebihi 100%');
    await expect(saveRoundRobinSettings(3, { enabled: false, shares: [{ userId: 1, percent: 10 }, { userId: 1, percent: 10 }] })).rejects.toThrow('dua kali');
  });

  it('menolak CS yang tidak aktif/tidak terhubung ke brand', async () => {
    mocks.userFindMany.mockResolvedValue([{ id: 1 }]);
    await expect(saveRoundRobinSettings(3, { enabled: true, shares: [{ userId: 1, percent: 50 }, { userId: 99, percent: 50 }] })).rejects.toThrow('tidak aktif atau tidak terhubung');
  });

  it('menyimpan: kunci brand, reset counter, upsert tiap CS, nolkan CS yang tak ada di daftar', async () => {
    mocks.userFindMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    mocks.brandFind.mockResolvedValue({ roundRobinEnabled: true });
    mocks.userFindMany.mockResolvedValueOnce([]);
    await saveRoundRobinSettings(3, { enabled: true, shares: [{ userId: 1, percent: 70 }, { userId: 2, percent: 30 }] });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.brandUpdate).toHaveBeenCalledWith({ where: { id: 3 }, data: { roundRobinEnabled: true } });
    expect(mocks.shareUpdateMany).toHaveBeenNthCalledWith(1, { where: { brandId: 3 }, data: { assignedCount: 0 } });
    expect(mocks.shareUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.shareUpsert.mock.calls[0][0]).toMatchObject({ create: { userId: 1, percent: 70, assignedCount: 0 }, update: { percent: 70, assignedCount: 0 } });
    expect(mocks.shareUpdateMany).toHaveBeenNthCalledWith(2, { where: { brandId: 3, userId: { notIn: [1, 2] } }, data: { percent: 0 } });
  });
});
