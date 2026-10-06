import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prospectUpdateMany: vi.fn((args: unknown) => ({ model: 'prospect', args })),
  messageUpdateMany: vi.fn((args: unknown) => ({ model: 'chatMessage', args })),
  transaction: vi.fn(async (ops: unknown[]) => ops.map(() => ({ count: 3 }))),
}));
vi.mock('../../db/prisma.js', () => ({
  prisma: {
    prospect: { updateMany: mocks.prospectUpdateMany },
    chatMessage: { updateMany: mocks.messageUpdateMany },
    $transaction: mocks.transaction,
  },
}));

import { adoptUnassignedProspects } from './device-scope.js';

describe('Device tersambung mengadopsi data tanpa device', () => {
  it('pesan ikut diikat ke device prospeknya agar riwayat chat tetap tampil', async () => {
    expect(await adoptUnassignedProspects(1, '+62 822-2000')).toBe(3);
    expect(mocks.prospectUpdateMany).toHaveBeenCalledWith({ where: { brandId: 1, devicePhone: null }, data: { devicePhone: '628222000' } });
    expect(mocks.messageUpdateMany).toHaveBeenCalledWith({
      where: { brandId: 1, devicePhone: null, prospect: { is: { devicePhone: '628222000' } } },
      data: { devicePhone: '628222000' },
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it('tanpa nomor device tidak ada yang diubah', async () => {
    mocks.transaction.mockClear();
    expect(await adoptUnassignedProspects(1, null)).toBe(0);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
