import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notify: vi.fn(async () => 1),
  resolve: vi.fn(async () => 0),
  session: vi.fn(),
  openNotifications: vi.fn(async () => [] as { userId: number }[]),
  pendingProofs: vi.fn(async () => [] as unknown[]),
  notificationUpdateMany: vi.fn(async () => ({ count: 0 })),
  emitToUser: vi.fn(),
}));
vi.mock('../../realtime/socket.js', () => ({ emitToUser: mocks.emitToUser }));

vi.mock('./notify.service.js', () => ({ notify: mocks.notify, resolveNotifications: mocks.resolve }));
vi.mock('./recipients.js', () => ({
  picOf: async (p: { userId: number | null }) => (p.userId ? [p.userId] : []),
  csOfBrand: async () => [21, 22],
  financeUsers: async () => [31],
  financeOrAdmins: async () => [31],
  productUsers: async () => [51],
  productOrSuperadmins: async () => [51],
  adminsOf: async () => [41, 1],
}));
vi.mock('../../db/prisma.js', () => ({
  prisma: {
    brand: { findUnique: async () => ({ name: 'Hana' }) },
    whatsappSession: { findUnique: mocks.session },
    notification: { findMany: mocks.openNotifications, updateMany: mocks.notificationUpdateMany },
    package: { findUnique: async () => ({ id: 5, name: 'Syawal', brandId: 1, quotaRemaining: 0 }) },
    // Antrean bukti (dicari lewat paymentProofUrl) vs PIC pemegang paket (kuota).
    prospect: { findMany: async ({ where }: any) => (where.paymentProofUrl ? mocks.pendingProofs() : [{ userId: 21 }, { userId: 99 }]) },
  },
}));

import { notifyPaymentVerified, notifyPicChange, notifyProofSubmitted, notifyQuotaAfterBooking, onWhatsappStatus, refreshProofSummary } from './notification.events.js';

const prospect = { id: 7, brandId: 1, name: 'Ibu Aisyah' };
const sent = () => mocks.notify.mock.calls.map(([arg]: any) => arg);

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe('perubahan PIC', () => {
  it('diambil alih: PIC lama mendapat notifikasi mendesak; pengingat miliknya ditutup', async () => {
    await notifyPicChange({ prospect, kind: 'taken_over', fromUserId: 21, toUserId: 22, actor: { id: 22, name: 'Rahma' }, waitedMinutes: 18 });
    expect(sent()).toEqual([expect.objectContaining({ type: 'pic.taken_over', priority: 'urgent', userIds: [21], actorId: 22 })]);
    expect(sent()[0].body).toContain('18 menit');
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ types: ['message.inbound', 'lead.assigned'], userIds: [21] }));
  });

  it('diserahkan: PIC baru menerima alasan, PIC lama mendapat info', async () => {
    await notifyPicChange({ prospect, kind: 'handover', fromUserId: 21, toUserId: 22, toName: 'Rahma', actor: { id: 21, name: 'Fitri' }, reason: 'Cuti' });
    expect(sent().map((n) => [n.type, n.userIds])).toEqual([['pic.handover_received', [22]], ['pic.released', [21]]]);
    expect(sent()[0].body).toBe('Alasan: Cuti');
  });

  it('klaim hanya menutup antrean tanpa PIC, tanpa notifikasi baru', async () => {
    await notifyPicChange({ prospect, kind: 'claimed', fromUserId: null, toUserId: 22, actor: { id: 22, name: 'Rahma' } });
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ types: ['lead.unassigned'] }));
  });
});

describe('pembayaran & kuota', () => {
  it('verifikasi menutup "bukti baru", memberi tahu PIC, tanpa tugas keuangan lanjutan', async () => {
    await notifyPaymentVerified({
      prospect: { ...prospect, userId: 21 }, actor: { id: 31, name: 'Finance' }, amount: 70_000_000, paymentType: 'full',
    });
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ types: ['payment.proof_new', 'payment.proof_stale'] }));
    expect(sent().map((n) => n.type)).toEqual(['payment.verified']);
    expect(sent()[0].title).toBe('Deal! Pembayaran awal Ibu Aisyah diverifikasi');
  });

  it('kuota habis: hanya PIC CS brand yang sedang menawarkan paket dan Admin', async () => {
    await notifyQuotaAfterBooking(5, { id: 31, name: 'Finance' });
    expect(sent().map((n) => [n.type, n.userIds])).toEqual([['package.quota_low', [21]], ['package.quota_empty', [41, 1]]]);
  });
});

describe('perangkat WhatsApp', () => {
  it('kedipan singkat tidak dilaporkan; terputus lebih dari 2 menit dilaporkan ke Admin', async () => {
    vi.useFakeTimers();
    await onWhatsappStatus(1, 'disconnected', 1000);
    await onWhatsappStatus(1, 'connected', 1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.notify).not.toHaveBeenCalled();

    mocks.session.mockResolvedValue({ status: 'disconnected', updatedAt: new Date('2026-09-24T01:00:00Z') });
    await onWhatsappStatus(1, 'disconnected', 1000);
    await vi.advanceTimersByTimeAsync(1500);
    expect(sent()).toEqual([expect.objectContaining({ type: 'wa.disconnected', priority: 'urgent', userIds: [41, 1] })]);
    // Kunci dedupe per kejadian putus: job terjadwal untuk kejadian yang sama tidak mengirim ulang.
    expect(sent()[0].dedupeKey).toBe(`wa.disconnected:b1:${new Date('2026-09-24T01:00:00Z').getTime()}`);
  });

  it('tersambung lagi menutup notifikasi dan mengirim info ke penerima yang sama', async () => {
    mocks.openNotifications.mockResolvedValue([{ userId: 41 }]);
    await onWhatsappStatus(2, 'connected');
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ types: ['wa.disconnected'] }));
    expect(sent()).toEqual([expect.objectContaining({ type: 'wa.reconnected', userIds: [41] })]);
  });
});

describe('ringkasan bukti transfer untuk Finance', () => {
  const proof = (url: string, used = false) => ({ paymentProofUrl: url, payments: used ? [{ proofUrl: url }] : [] });

  it('satu ringkasan per Finance dengan jumlah antrean saat ini (bukan satu per prospek)', async () => {
    mocks.pendingProofs.mockResolvedValue([proof('a'), proof('b'), proof('c', true)]);
    await notifyProofSubmitted(prospect, { id: 21, name: 'Fitri' }, true);
    expect(sent()).toEqual([expect.objectContaining({
      type: 'payment.proof_new', title: 'Bukti transfer menunggu verifikasi', activeKey: 'payment.proof_new', setCount: 2, userIds: [31],
    })]);
    expect(sent()[0].body).toContain('2 bukti menunggu');
  });

  it('setelah verifikasi: angka diperbarui tanpa toast; antrean kosong menutup ringkasan', async () => {
    mocks.pendingProofs.mockResolvedValueOnce([proof('a')]);
    mocks.openNotifications.mockResolvedValueOnce([{ id: 9, userId: 31 }] as any);
    await refreshProofSummary();
    expect(mocks.notificationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ count: 1 }) }));
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.emitToUser).toHaveBeenCalledWith(31, 'notification:updated', { ids: [9] });

    mocks.pendingProofs.mockResolvedValueOnce([]);
    await refreshProofSummary();
    expect(mocks.resolve).toHaveBeenCalledWith({ types: ['payment.proof_new'] });
  });
});
