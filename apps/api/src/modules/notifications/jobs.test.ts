import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notify: vi.fn(async () => 1),
  resolve: vi.fn(async () => 0),
  prospectFindMany: vi.fn(),
  userFindMany: vi.fn(async () => [] as { id: number }[]),
  brandFindMany: vi.fn(async () => [] as unknown[]),
  logFindMany: vi.fn(async () => [] as unknown[]),
  deleteMany: vi.fn(async () => ({ count: 1 })),
}));

vi.mock('./notify.service.js', () => ({ notify: mocks.notify, resolveNotifications: mocks.resolve }));
vi.mock('./notification.events.js', () => ({ notifyWhatsappDisconnected: vi.fn() }));
vi.mock('../chat/chat.routes.js', () => ({ getLivechatConversationsForBrand: vi.fn() }));
vi.mock('./recipients.js', () => ({
  picOf: async (p: { userId: number | null }) => (p.userId ? [p.userId] : []),
  csOfBrand: async () => [21, 22, 23],
  financeUsers: async () => [31],
  adminsOf: async () => [41],
}));
vi.mock('../../db/prisma.js', () => ({
  prisma: {
    prospect: { findMany: mocks.prospectFindMany },
    user: { findMany: mocks.userFindMany },
    brand: { findMany: mocks.brandFindMany },
    prospectLog: { findMany: mocks.logFindMany },
    notification: { deleteMany: mocks.deleteMany },
    notificationDedupe: { deleteMany: mocks.deleteMany },
  },
}));

import { gatewayHealthJob, morningDigestJob, proofStaleJob, replySlaForBrand, resetGatewayState, retentionJob, SLA } from './jobs.js';

const NOW = new Date('2026-09-24T03:00:00Z'); // 10.00 WIB
const minutesAgo = (m: number) => NOW.getTime() / 1000 - m * 60;
const sent = () => mocks.notify.mock.calls.map(([arg]: any) => arg);
const conversation = (overrides: Record<string, unknown>) => ({
  id: 1, name: 'Ibu Aisyah', status: 'contact', userId: 21, user: { name: 'Fitri' }, isGroup: false, isOwn: false,
  remoteJid: '62811@s.whatsapp.net', awaitingSince: null, createdAt: new Date(NOW.getTime() - 5 * 3600_000), ...overrides,
}) as any;

beforeEach(() => {
  vi.clearAllMocks();
  resetGatewayState();
});

describe('SLA balasan', () => {
  it('10 menit: peringatan mendesak ke PIC, sekali per episode menunggu', async () => {
    await replySlaForBrand(1, [conversation({ awaitingSince: minutesAgo(12) })], NOW);
    expect(sent()).toEqual([expect.objectContaining({ type: 'reply.sla_warning', priority: 'urgent', userIds: [21], dedupeKey: `reply.sla_warning:p1:${minutesAgo(12)}` })]);
  });

  it('15 menit: CS lain (bukan PIC) diberi tahu dalam satu ringkasan per brand', async () => {
    await replySlaForBrand(1, [conversation({ awaitingSince: minutesAgo(20) })], NOW);
    expect(sent().map((n) => n.type)).toEqual(['reply.takeover_open']);
    expect(sent()[0]).toMatchObject({ userIds: [22, 23], activeKey: 'reply.takeover_open:b1' });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('30 menit: eskalasi ke Admin', async () => {
    await replySlaForBrand(1, [conversation({ awaitingSince: minutesAgo(35) })], NOW);
    expect(sent().map((n) => [n.type, n.userIds])).toEqual([['reply.takeover_open', [22, 23]], ['reply.escalation', [41]]]);
  });

  it('episode lebih dari 3 jam, grup, Deal, atau sudah dibalas diabaikan; ringkasan brand ditutup', async () => {
    await replySlaForBrand(1, [
      conversation({ id: 1, awaitingSince: minutesAgo(SLA.maxEpisodeHours * 60 + 5) }),
      conversation({ id: 2, awaitingSince: minutesAgo(40), isGroup: true }),
      conversation({ id: 3, awaitingSince: minutesAgo(40), status: 'deal' }),
      conversation({ id: 4, awaitingSince: null }),
    ], NOW);
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.resolve).toHaveBeenCalledWith({ entity: { type: 'brand', id: 1 }, types: ['reply.takeover_open'] });
  });

  it('lead tanpa PIC lebih dari 30 menit dilaporkan ke Admin', async () => {
    await replySlaForBrand(1, [
      conversation({ id: 5, userId: null, createdAt: new Date(NOW.getTime() - 40 * 60_000) }),
      conversation({ id: 6, userId: null, createdAt: new Date(NOW.getTime() - 10 * 60_000) }),
    ], NOW);
    expect(sent()).toEqual([expect.objectContaining({ type: 'lead.unassigned', userIds: [41], dedupeKey: 'lead.unassigned:p5:30m' })]);
  });
});

describe('bukti transfer menunggu', () => {
  it('2 jam ke Finance; 1 hari juga ke Admin; bukti yang sudah dipakai diabaikan', async () => {
    const at = (hours: number) => new Date(NOW.getTime() - hours * 3600_000);
    mocks.prospectFindMany.mockResolvedValue([
      { id: 1, brandId: 1, name: 'A', paymentProofUrl: 'p1', paymentProofSubmittedAt: at(3), brand: { name: 'Hana' }, payments: [] },
      { id: 2, brandId: 1, name: 'B', paymentProofUrl: 'p2', paymentProofSubmittedAt: at(30), brand: { name: 'Hana' }, payments: [] },
      { id: 3, brandId: 1, name: 'C', paymentProofUrl: 'p3', paymentProofSubmittedAt: at(5), brand: { name: 'Hana' }, payments: [{ proofUrl: 'p3' }] },
    ]);
    await proofStaleJob(NOW);
    expect(sent().map((n) => [n.title, n.userIds])).toEqual([
      ['Bukti transfer A menunggu 3 jam', [31]],
      ['Bukti transfer B menunggu 30 jam', [31, 41]],
    ]);
    expect(sent()[1].dedupeKey).toMatch(/:2$/);
  });
});

describe('ringkasan pagi', () => {
  it('follow-up hari ini dan terlambat per CS aktif, sekali per tanggal', async () => {
    mocks.prospectFindMany
      .mockResolvedValueOnce([
        { userId: 21, nextFollowupDate: new Date('2026-09-24T00:00:00Z') },
        { userId: 21, nextFollowupDate: new Date('2026-09-20T00:00:00Z') },
        { userId: 21, nextFollowupDate: new Date('2026-09-21T00:00:00Z') },
        { userId: 99, nextFollowupDate: new Date('2026-09-24T00:00:00Z') },
      ])
      .mockResolvedValueOnce([]);
    mocks.userFindMany.mockResolvedValueOnce([{ id: 21 }]);
    await morningDigestJob(NOW);
    expect(sent().map((n) => [n.type, n.title, n.dedupeKey])).toEqual([
      ['followup.due_today', '1 follow-up hari ini', 'followup.due_today:u21:2026-09-24'],
      ['followup.overdue', '2 follow-up terlambat', 'followup.overdue:u21:2026-09-24'],
    ]);
  });
});

describe('gateway WhatsApp', () => {
  it('dua kegagalan berturut-turut = mati; pulih menutup dan memberi info', async () => {
    mocks.userFindMany.mockResolvedValue([{ id: 1 }]);
    await gatewayHealthJob(NOW, async () => false);
    expect(mocks.notify).not.toHaveBeenCalled();
    await gatewayHealthJob(NOW, async () => false);
    await gatewayHealthJob(NOW, async () => false);
    expect(sent().map((n) => n.type)).toEqual(['system.gateway_down']);
    await gatewayHealthJob(NOW, async () => true);
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ types: ['system.gateway_down'] }));
    expect(sent().map((n) => n.type)).toEqual(['system.gateway_down', 'system.gateway_up']);
  });
});

describe('retensi', () => {
  it('menghapus notifikasi dibaca > 60 hari, belum dibaca > 180 hari, dan kunci dedupe lama', async () => {
    await retentionJob(NOW);
    const wheres = mocks.deleteMany.mock.calls.map(([arg]: any) => arg.where);
    expect(wheres[0].readAt.lt).toEqual(new Date(NOW.getTime() - 60 * 86_400_000));
    expect(wheres[1]).toMatchObject({ readAt: null, createdAt: { lt: new Date(NOW.getTime() - 180 * 86_400_000) } });
    expect(wheres[2].createdAt.lt).toEqual(new Date(NOW.getTime() - 14 * 86_400_000));
  });
});
