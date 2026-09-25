import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  conversations: vi.fn(),
  prospectFindMany: vi.fn(),
  prospectCount: vi.fn(async () => 0),
  brandFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
}));

vi.mock('../chat/chat.routes.js', () => ({ getLivechatConversationsForBrand: mocks.conversations }));
vi.mock('../../db/prisma.js', () => ({
  prisma: {
    prospect: { findMany: mocks.prospectFindMany, count: mocks.prospectCount },
    brand: { findMany: mocks.brandFindMany },
    whatsappSession: { findMany: mocks.sessionFindMany },
  },
}));

import { tasksForCs, tasksForFinance, tasksForManager } from './tasks.service.js';

const NOW = new Date('2026-09-24T03:00:00Z'); // 10.00 WIB
const minutesAgo = (m: number) => NOW.getTime() / 1000 - m * 60;
const conv = (overrides: Record<string, unknown>) => ({
  id: 1, brandId: 1, name: 'Jamaah', status: 'contact', userId: 7, user: { name: 'Fitri' }, isGroup: false, isOwn: false,
  remoteJid: '62811@s.whatsapp.net', awaitingSince: null, nextFollowupDate: null, invoiceDueAt: null,
  createdAt: new Date(NOW.getTime() - 3_600_000), ...overrides,
});
const byKey = (tasks: { key: string }[]) => Object.fromEntries(tasks.map((t: any) => [t.key, t]));

beforeEach(() => vi.clearAllMocks());

describe('Ringkasan CS', () => {
  it('pekerjaan saya: menunggu balasan (terlama), follow-up, invoice lewat, bisa diambil alih, lead tanpa PIC', async () => {
    mocks.conversations.mockResolvedValue([
      conv({ id: 1, awaitingSince: minutesAgo(12) }),
      conv({ id: 2, awaitingSince: minutesAgo(3), nextFollowupDate: new Date('2026-09-24T00:00:00Z') }),
      conv({ id: 3, nextFollowupDate: new Date('2026-09-20T00:00:00Z'), status: 'closing', invoiceDueAt: new Date('2026-09-23T00:00:00Z') }),
      conv({ id: 4, userId: 8, user: { name: 'Rahma' }, awaitingSince: minutesAgo(20) }),
      conv({ id: 5, userId: null, user: null }),
      conv({ id: 6, status: 'deal', awaitingSince: minutesAgo(40) }),
    ]);
    const result = await tasksForCs({ id: 7, role: 'cs' }, [1], NOW);
    const t = byKey(result.tasks);
    expect(t.reply).toMatchObject({ count: 2, tone: 'urgent', hint: 'Terlama 12 menit' });
    expect(t.followup_today.count).toBe(1);
    expect(t.followup_late).toMatchObject({ count: 1, tone: 'urgent' });
    expect(t.invoice_late.count).toBe(1);
    expect(t.takeover.count).toBe(1);
    expect(t.unassigned.count).toBe(1);
    expect(result.waiting?.items.map((i) => i.id)).toEqual([1, 2]);
  });

  it('semua beres: tugas bertanda clear', async () => {
    mocks.conversations.mockResolvedValue([conv({ id: 1 })]);
    const result = await tasksForCs({ id: 7, role: 'cs' }, [1], NOW);
    expect(result.tasks.every((t) => t.tone === 'clear')).toBe(true);
    expect(result.waiting).toBeNull();
  });
});

describe('Ringkasan Finance', () => {
  it('Finance hanya mendapat tugas bukti pembayaran awal dan daftar terlama', async () => {
    const at = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
    mocks.prospectFindMany
      .mockResolvedValueOnce([
        { id: 1, brandId: 1, name: 'A', paymentProofUrl: 'p1', paymentProofSubmittedAt: at(3), payments: [] },
        { id: 2, brandId: 1, name: 'B', paymentProofUrl: 'p2', paymentProofSubmittedAt: at(1), payments: [] },
        { id: 3, brandId: 1, name: 'C', paymentProofUrl: 'p3', paymentProofSubmittedAt: at(5), payments: [{ proofUrl: 'p3' }] },
      ]);
    mocks.brandFindMany.mockResolvedValue([{ id: 1, name: 'Hana' }]);
    const result = await tasksForFinance([1], NOW);
    const t = byKey(result.tasks);
    expect(t.proofs).toMatchObject({ count: 2, tone: 'urgent', hint: '1 lebih dari 2 jam · terlama 3 jam' });
    expect(Object.keys(t)).toEqual(['proofs']);
    expect(mocks.prospectFindMany.mock.calls[0][0].where.status.notIn).toEqual(expect.arrayContaining(['deal', 'closed_won']));
    expect(result.waiting?.items.map((i) => i.name)).toEqual(['A', 'B']);
  });
});

describe('Ringkasan Admin', () => {
  it('SLA 15/30 menit, lead tanpa PIC, perangkat terputus, brand tanpa CS', async () => {
    // Brand 1 berisi percakapan; brand 2 kosong (daftar diambil per brand).
    mocks.conversations.mockImplementation(async (brandId: number) => (brandId === 2 ? [] : [
      conv({ id: 1, awaitingSince: minutesAgo(35) }),
      conv({ id: 2, awaitingSince: minutesAgo(16) }),
      conv({ id: 3, awaitingSince: minutesAgo(5) }),
      conv({ id: 4, userId: null, user: null, createdAt: new Date(NOW.getTime() - 40 * 60_000) }),
    ]));
    mocks.prospectFindMany.mockResolvedValue([]);
    mocks.sessionFindMany.mockResolvedValue([{ brandId: 1, status: 'connected' }, { brandId: 2, status: 'disconnected' }]);
    mocks.brandFindMany.mockResolvedValue([
      { id: 1, name: 'Hana', _count: { users: 2 }, userBrands: [] },
      { id: 2, name: 'Azhan', _count: { users: 0 }, userBrands: [] },
    ]);
    const result = await tasksForManager([1, 2], NOW);
    const t = byKey(result.tasks);
    expect(t.reply_sla).toMatchObject({ count: 2, tone: 'urgent', hint: '1 di antaranya lebih dari 30 menit', action: 'Lihat' });
    expect(t.unassigned).toMatchObject({ count: 1, tone: 'urgent', action: 'Bagikan' });
    expect(t.wa_disconnected).toMatchObject({ count: 1, hint: 'Azhan: chat jamaah tidak masuk', action: 'Hubungkan' });
    // Brand tanpa CS tanpa lead tertahan: tetap tampil, tetapi belum mendesak.
    expect(t.no_cs).toMatchObject({ count: 1, tone: 'action', action: 'Tambah CS' });
    expect(result.waiting?.items[0]).toMatchObject({ id: 1, brandName: 'Hana', picName: 'Fitri' });
  });
});

describe('Angka yang bisa dipercaya (audit Ringkasan R1–R4, R13)', () => {
  it('percakapan lebih dari 24 jam bukan "belum dibalas" mendesak, melainkan terbengkalai', async () => {
    mocks.conversations.mockResolvedValue([
      conv({ id: 1, awaitingSince: minutesAgo(48 * 24 * 60) }),
      conv({ id: 2, awaitingSince: minutesAgo(20) }),
    ]);
    mocks.prospectFindMany.mockResolvedValue([]);
    mocks.sessionFindMany.mockResolvedValue([{ brandId: 1, status: 'connected' }]);
    mocks.brandFindMany.mockResolvedValue([{ id: 1, name: 'Hana', _count: { users: 2 }, userBrands: [] }]);
    const result = await tasksForManager([1], NOW);
    const t = byKey(result.tasks);
    expect(t.reply_sla.count).toBe(1);
    expect(t.stale).toMatchObject({ count: 1, tone: 'action' });
    expect(result.waiting?.items.map((i) => i.id)).toEqual([2]);
  });

  it('lead tanpa PIC dipisah menurut penyebab: brand tanpa CS (Tambah CS) vs perlu dibagikan', async () => {
    mocks.conversations.mockImplementation(async (brandId: number) => (brandId === 2
      ? [conv({ id: 7, brandId: 2, userId: null, user: null }), conv({ id: 8, brandId: 2, userId: null, user: null })]
      : [conv({ id: 9, brandId: 1, userId: null, user: null })]));
    mocks.prospectFindMany.mockResolvedValue([]);
    mocks.sessionFindMany.mockResolvedValue([{ brandId: 1, status: 'connected' }, { brandId: 2, status: 'connected' }]);
    mocks.brandFindMany.mockResolvedValue([
      { id: 1, name: 'Hana', _count: { users: 2 }, userBrands: [] },
      { id: 2, name: 'Nava', _count: { users: 0 }, userBrands: [] },
    ]);
    const t = byKey((await tasksForManager([1, 2], NOW)).tasks);
    // Satu masalah = satu baris: lead Nava tidak dihitung dua kali.
    expect(t.no_cs).toMatchObject({ count: 2, link: '/staff', tone: 'urgent', hint: 'Nava. Tambahkan CS agar lead bisa dibalas dan dibagikan' });
    expect(t.unassigned).toMatchObject({ count: 1, link: '/pipeline?pic=none&brandId=1' });
  });

  it('tanpa masalah CS: tautan Pipeline membawa brand dengan antrean terbanyak', async () => {
    mocks.conversations.mockImplementation(async (brandId: number) => (brandId === 2
      ? [conv({ id: 7, brandId: 2, userId: null, user: null }), conv({ id: 8, brandId: 2, userId: null, user: null })]
      : []));
    mocks.prospectFindMany.mockResolvedValue([]);
    mocks.sessionFindMany.mockResolvedValue([]);
    mocks.brandFindMany.mockResolvedValue([
      { id: 1, name: 'Hana', _count: { users: 1 }, userBrands: [] },
      { id: 2, name: 'Nava', _count: { users: 1 }, userBrands: [] },
    ]);
    const t = byKey((await tasksForManager([1, 2], NOW)).tasks);
    expect(t.unassigned.link).toBe('/pipeline?pic=none&brandId=2');
  });

  it('PIC bukan CS aktif dan Deal tanpa nilai booking dilaporkan', async () => {
    mocks.conversations.mockResolvedValue([]);
    mocks.prospectFindMany.mockResolvedValue([]);
    mocks.sessionFindMany.mockResolvedValue([{ brandId: 1, status: 'connected' }]);
    mocks.brandFindMany.mockResolvedValue([{ id: 1, name: 'Hana', _count: { users: 1 }, userBrands: [] }]);
    mocks.prospectCount.mockImplementation(async ({ where }: any) => (where.user ? 4 : where.dealValue ? 1 : 0));
    const t = byKey((await tasksForManager([1], NOW)).tasks);
    expect(t.invalid_pic.count).toBe(4);
    expect(t.deal_incomplete.count).toBe(1);
    const invalidWhere = mocks.prospectCount.mock.calls.find(([arg]: any) => arg.where.user)![0].where;
    expect(invalidWhere.user).toEqual({ is: { OR: [{ role: { not: 'cs' } }, { isActive: false }] } });
    mocks.prospectCount.mockReset();
    mocks.prospectCount.mockResolvedValue(0);
  });
});
