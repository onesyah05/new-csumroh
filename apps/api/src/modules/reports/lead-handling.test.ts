import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn(), userFindMany: vi.fn(), chatFindMany: vi.fn() }));
vi.mock('../../db/prisma.js', () => ({
  prisma: { $queryRaw: mocks.queryRaw, user: { findMany: mocks.userFindMany }, chatMessage: { findMany: mocks.chatFindMany } },
}));

import { leadHandling } from './lead-handling.js';

// 1 Sep 2026 WIB = 31 Agu 17:00Z. Hari bisnis dihitung dari detik unix + 7 jam.
const sep1 = Date.UTC(2026, 7, 31, 17) / 1000;
const day = (ts: number) => Math.floor((ts + 7 * 3600) / 86_400);
const range = { gte: new Date(sep1 * 1000), lte: new Date((sep1 + 86_399) * 1000) };
const users = [{ id: 7, name: 'Aisyah', isActive: true }, { id: 8, name: 'Budi', isActive: true }];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.userFindMany.mockResolvedValue([]);
  mocks.chatFindMany.mockResolvedValue([]);
});

describe('Lead Harian', () => {
  it('memisahkan lead baru dan lama per nomor, mencocokkan nama untuk data lama, dan menaruh chat HP di baris sendiri', async () => {
    const d = day(sep1 + 3600);
    mocks.queryRaw
      // Hari × nomor × pengirim dalam periode.
      .mockResolvedValueOnce([
        { day: d, prospect_id: 1, sender_user_id: 7, sender_name: 'Aisyah' }, // baru (balasan pertama hari ini)
        { day: d, prospect_id: 2, sender_user_id: 7, sender_name: 'Aisyah' }, // lama (sudah dibalas kemarin)
        { day: d, prospect_id: 2, sender_user_id: null, sender_name: 'aisyah ' }, // data lama: nama sama, nomor sama → sekali
        { day: d, prospect_id: 3, sender_user_id: null, sender_name: 'Budi' }, // data lama, cocok nama → Budi, lama
        { day: d, prospect_id: 4, sender_user_id: null, sender_name: 'Hana Tours Travel' }, // dari HP, baru
      ])
      // Balasan keluar pertama per nomor sepanjang masa.
      .mockResolvedValueOnce([
        { prospect_id: 1, first_out: sep1 + 3600 },
        { prospect_id: 2, first_out: sep1 - 5000 },
        { prospect_id: 3, first_out: sep1 - 90_000 },
        { prospect_id: 4, first_out: sep1 + 7200 },
      ])
      // Pesan jamaah pertama untuk lead baru.
      .mockResolvedValueOnce([{ prospect_id: 1, first_in: sep1 + 3000 }, { prospect_id: 4, first_in: sep1 + 6000 }]);
    mocks.chatFindMany.mockResolvedValueOnce([
      { prospectId: 1, timestamp: sep1 + 3600, senderUserId: 7, senderName: 'Aisyah' },
      { prospectId: 4, timestamp: sep1 + 7200, senderUserId: null, senderName: 'Hana Tours Travel' },
    ]);

    const rows = await leadHandling([1], users, range);
    expect(rows).toEqual([
      { key: 'user:7', userId: 7, name: 'Aisyah', isActive: true, newLeads: 1, oldLeads: 1, medianReplyMinutes: 10 },
      { key: 'user:8', userId: 8, name: 'Budi', isActive: true, newLeads: 0, oldLeads: 1, medianReplyMinutes: null },
      { key: 'hp', userId: null, name: 'Dari HP (tanpa nama)', isActive: true, newLeads: 1, oldLeads: 0, medianReplyMinutes: 20 },
    ]);
  });

  it('nomor yang dichat dua hari: hari pertama baru, hari kedua lama; CS nol tetap tampil', async () => {
    const d1 = day(sep1 + 100);
    mocks.queryRaw
      .mockResolvedValueOnce([
        { day: d1, prospect_id: 5, sender_user_id: 7, sender_name: 'Aisyah' },
        { day: d1 + 1, prospect_id: 5, sender_user_id: 7, sender_name: 'Aisyah' },
      ])
      .mockResolvedValueOnce([{ prospect_id: 5, first_out: sep1 + 100 }])
      .mockResolvedValueOnce([]);
    const twoDays = { gte: range.gte, lte: new Date((sep1 + 2 * 86_400 - 1) * 1000) };
    const rows = await leadHandling([1], users, twoDays);
    expect(rows.map((r) => [r.name, r.newLeads, r.oldLeads])).toEqual([['Aisyah', 1, 1], ['Budi', 0, 0]]);
  });
});
