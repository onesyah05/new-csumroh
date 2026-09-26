import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const mocks = vi.hoisted(() => ({
  prospectFindMany: vi.fn(),
  messageFindMany: vi.fn(),
  messageFindFirst: vi.fn(),
  paymentFindMany: vi.fn(),
  paymentFindUnique: vi.fn(),
  paymentUpdate: vi.fn(),
  paymentUpdateMany: vi.fn(),
  paymentAggregate: vi.fn(),
  rejectionFindMany: vi.fn(),
  rejectionCreate: vi.fn(),
  prospectUpdate: vi.fn(),
  prospectUpdateMany: vi.fn(),
  prospectFindUnique: vi.fn(),
  packageUpdateMany: vi.fn(),
  logCreate: vi.fn(),
  userFindMany: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('../../db/prisma.js', () => {
  const client: any = {
    prospect: { findMany: mocks.prospectFindMany, update: mocks.prospectUpdate, updateMany: mocks.prospectUpdateMany, findUnique: mocks.prospectFindUnique },
    chatMessage: { findMany: mocks.messageFindMany, findFirst: mocks.messageFindFirst },
    payment: { findMany: mocks.paymentFindMany, findUnique: mocks.paymentFindUnique, update: mocks.paymentUpdate, updateMany: mocks.paymentUpdateMany, aggregate: mocks.paymentAggregate },
    paymentProofRejection: { findMany: mocks.rejectionFindMany, create: mocks.rejectionCreate },
    package: { updateMany: mocks.packageUpdateMany },
    prospectLog: { create: mocks.logCreate },
    user: { findMany: mocks.userFindMany },
  };
  client.$transaction = (fn: any) => fn(client);
  return { prisma: client };
});
vi.mock('../../realtime/socket.js', () => ({ emitToBrand: mocks.emit }));
vi.mock('../../middleware/auth.js', () => ({
  authGuard: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  scopedBrandId: (_req: any, requested?: number) => requested ?? 1,
}));

import { verificationRouter } from './verification.routes.js';

function call(method: string, routePath: string, req: Row = {}) {
  const layer = (verificationRouter as any).stack.find((l: any) => l.route?.path === routePath && l.route.methods[method]);
  return new Promise<any>((resolve, reject) => {
    const res: any = {
      headers: {} as Row,
      setHeader: (k: string, v: string) => { res.headers[k] = v; },
      json: (body: any) => resolve(body.data ?? body),
      send: (body: any) => resolve({ body, headers: res.headers }),
      status: () => res,
    };
    layer.route.stack.at(-1).handle({ query: {}, params: {}, body: {}, user: { id: 1, name: 'Super', role: 'superadmin' }, ...req }, res, reject);
  });
}
const queue = (query: Row = {}) => call('get', '/queue', { query });

const invoiceAt = new Date('2026-09-20T03:00:00.000Z');
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const base = (id: number, overrides: Row = {}): Row => ({
  id, name: `Jamaah ${id}`, status: 'closing', paymentStatus: 'unpaid', invoiceSentAt: invoiceAt,
  paymentProofUrl: null, paymentProofMessageId: null, payments: [], proofRejections: [], customRequests: [], ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Antrean verifikasi Finance', () => {
  it('lists proofs not yet used by a verified payment, excluding settlement proofs on deals', async () => {
    const pending = base(1, { paymentProofUrl: '/p/a.jpg' });
    const verified = base(2, { paymentProofUrl: '/p/b.jpg', payments: [{ proofUrl: '/p/b.jpg', createdAt: invoiceAt }] });
    const settlement = base(3, { status: 'deal', paymentStatus: 'partial_dp', paymentProofUrl: '/p/c2.jpg', payments: [{ proofUrl: '/p/c1.jpg', createdAt: invoiceAt }] });
    mocks.prospectFindMany.mockResolvedValueOnce([pending, verified, settlement]);
    const data = await queue();
    expect(data.submitted.map((p: Row) => p.id)).toEqual([1]);
    expect(data.submitted[0]).not.toHaveProperty('payments');
    expect(mocks.prospectFindMany.mock.calls[0][0].where.status.notIn).toEqual(expect.arrayContaining(['deal', 'closed_won']));
  });

  it('hanya bukti yang diajukan; tidak ada lagi kandidat dari chat; scope brand diteruskan; custom membawa DP minimal', async () => {
    const pending = base(7, {
      paymentProofUrl: '/p/a.jpg',
      customRequests: [{ agreedPrice: 90_000_000, minDpPerPax: 5_000_000, minDpInfant: 1_000_000, paxQuad: 2, paxTriple: 0, paxDouble: 0, paxInfant: 1 }],
    });
    mocks.prospectFindMany.mockResolvedValueOnce([pending]);
    const data = await queue({ brandId: '2' });
    expect(Object.keys(data)).toEqual(['submitted']);
    expect(data.submitted[0]).toMatchObject({ id: 7, customMinDp: 11_000_000, customAgreedPrice: 90_000_000 });
    expect(mocks.prospectFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.messageFindMany).not.toHaveBeenCalled();
    expect(mocks.prospectFindMany.mock.calls[0]![0].where.brandId).toBe(2);
  });
});

describe('Riwayat verifikasi', () => {
  const brand = { id: 1, name: 'Azhan', code: 'AZ' };
  const person = (id: number, paymentStatus = 'partial_dp') => ({ id, name: `Jamaah ${id}`, phone: '0812', invoiceNumber: `INV-${id}`, paymentStatus, status: 'deal' });
  const pay = (id: number, overrides: Row = {}) => ({
    id, status: 'verified', createdAt: new Date(`2026-09-2${id}T03:00:00.000Z`), brand, prospect: person(id), amount: 5_000_000,
    bankName: 'BSI', referenceNo: `REF${id}`, mutationDate: new Date('2026-09-20T00:00:00.000Z'), notes: null, proofUrl: '/p.jpg',
    verifiedByUserId: 9, reversedByUserId: null, reversalReason: null, correctedAt: null, reversedAt: null, ...overrides,
  });

  it('menggabungkan pembayaran & penolakan (terbaru dulu) dengan total per bank', async () => {
    mocks.paymentFindMany.mockResolvedValue([pay(1), pay(3, { bankName: 'BCA', amount: 7_000_000, prospect: person(3, 'paid_full') }), pay(2, { status: 'reversed', reversedByUserId: 1 })]);
    mocks.rejectionFindMany.mockResolvedValue([{ id: 5, createdAt: new Date('2026-09-24T03:00:00.000Z'), brand, prospect: person(5), proofUrl: '/r.jpg', reason: 'Rekening salah', rejectedBy: { name: 'Fina' } }]);
    mocks.userFindMany.mockResolvedValue([{ id: 9, name: 'Fina' }, { id: 1, name: 'Super' }]);
    const data = await call('get', '/history', { query: {} });
    expect(data.items.map((r: Row) => [r.key, r.status])).toEqual([['r5', 'rejected'], ['p3', 'verified'], ['p2', 'reversed'], ['p1', 'verified']]);
    expect(data.items[1]).toMatchObject({ paymentType: 'full', actor: 'Fina' });
    expect(data.items[2]).toMatchObject({ reversedBy: 'Super' });
    expect(data.totals).toMatchObject({ verifiedCount: 2, verifiedAmount: 12_000_000, rejectedCount: 1, reversedCount: 1 });
    expect(data.totals.byBank.map((b: Row) => b.bankName)).toEqual(['BCA', 'BSI']);
  });

  it('filter status/tanggal/cari diteruskan ke query; CSV memakai BOM & header', async () => {
    mocks.paymentFindMany.mockResolvedValue([pay(1)]);
    mocks.userFindMany.mockResolvedValue([]);
    await call('get', '/history', { query: { status: 'verified', from: '2026-09-01', to: '2026-09-30', q: 'REF1', brandId: '2' } });
    const where = mocks.paymentFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ brandId: 2, status: 'verified' });
    expect(where.createdAt.gte.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(where.OR[0]).toEqual({ referenceNo: { contains: 'REF1' } });
    expect(mocks.rejectionFindMany).not.toHaveBeenCalled();

    const csv = await call('get', '/history', { query: { status: 'verified', format: 'csv' } });
    expect(csv.body.startsWith('﻿Waktu (WIB),Status')).toBe(true);
    expect(csv.body).toContain('"Terverifikasi","Azhan","Jamaah 1"');
    expect(csv.headers['Content-Type']).toContain('text/csv');

    // Nama kontak WhatsApp berisi formula tidak dieksekusi saat CSV dibuka di Excel.
    mocks.paymentFindMany.mockResolvedValue([pay(1, { prospect: { ...pay(1).prospect, name: '=HYPERLINK("http://x","klik")' } })]);
    const evil = await call('get', '/history', { query: { status: 'verified', format: 'csv' } });
    expect(evil.body).toContain(`"'=HYPERLINK(""http://x"",""klik"")"`);
  });
});

describe('Koreksi & pembatalan (Superadmin)', () => {
  const payment = (overrides: Row = {}) => ({
    id: 50, brandId: 1, prospectId: 7, status: 'verified', amount: 5_000_000, bankName: 'BSI', referenceNo: 'REF1',
    mutationDate: new Date('2026-09-20T00:00:00.000Z'),
    prospect: { id: 7, brandId: 1, name: 'Jamaah 7', status: 'deal', packageId: 4, seatsReserved: 3 }, ...overrides,
  });

  it('koreksi: nilai lama → baru tercatat, DP prospek dihitung ulang', async () => {
    mocks.paymentFindUnique.mockResolvedValue(payment());
    mocks.paymentAggregate.mockResolvedValue({ _sum: { amount: 50_000_000 } });
    await call('patch', '/payments/:id', { params: { id: '50' }, body: { amount: 50_000_000, bankName: 'BSI', referenceNo: 'REF1', mutationDate: '2026-09-20', reason: 'Salah ketik nol' } });
    expect(mocks.paymentUpdate.mock.calls[0][0].data).toMatchObject({ amount: 50_000_000, correctedAt: expect.any(Date) });
    expect(mocks.prospectUpdate.mock.calls[0][0].data.dpAmount).toBe(50_000_000);
    const log = mocks.logCreate.mock.calls[0][0].data;
    expect(log.actionType).toBe('payment_corrected');
    expect(log.description).toContain('Nominal: Rp 5.000.000 → Rp 50.000.000');
    expect(log.description).not.toContain('Bank:');
  });

  it('koreksi tanpa perubahan atau tanggal masa depan ditolak', async () => {
    mocks.paymentFindUnique.mockResolvedValue(payment());
    const same = { amount: 5_000_000, bankName: 'BSI', referenceNo: 'REF1', mutationDate: '2026-09-20', reason: 'Tidak ada' };
    await expect(call('patch', '/payments/:id', { params: { id: '50' }, body: same })).rejects.toMatchObject({ status: 422 });
    await expect(call('patch', '/payments/:id', { params: { id: '50' }, body: { ...same, mutationDate: '2999-01-01' } })).rejects.toMatchObject({ status: 422 });
    expect(mocks.paymentUpdate).not.toHaveBeenCalled();
  });

  it('pembatalan: Deal kembali ke Closing, kuota dikembalikan, bukti dilepas', async () => {
    mocks.paymentFindUnique.mockResolvedValue(payment());
    mocks.paymentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.prospectUpdateMany.mockResolvedValue({ count: 1 });
    mocks.paymentAggregate.mockResolvedValue({ _sum: { amount: null } });
    await call('post', '/payments/:id/reverse', { params: { id: '50' }, body: { reason: 'Mutasi tidak ditemukan' } });
    expect(mocks.paymentUpdateMany.mock.calls[0][0].data).toMatchObject({ status: 'reversed', reversalReason: 'Mutasi tidak ditemukan', reversedByUserId: 1 });
    expect(mocks.prospectUpdateMany.mock.calls[0][0]).toMatchObject({ where: { id: 7, status: 'deal' }, data: { status: 'closing' } });
    expect(mocks.packageUpdateMany.mock.calls[0][0].data).toEqual({ quotaRemaining: { increment: 3 } });
    expect(mocks.prospectUpdate.mock.calls[0][0].data).toMatchObject({ dpAmount: 0, paymentStatus: 'unpaid', seatsReserved: 0, paymentProofUrl: null });
    expect(mocks.logCreate.mock.calls[0][0].data.actionType).toBe('payment_reversed');
    expect(mocks.emit).toHaveBeenCalledWith(1, 'package:quota_updated', { packageId: 4 });
  });

  it('pembatalan hanya untuk prospek Deal dan pembayaran yang masih terverifikasi', async () => {
    mocks.paymentFindUnique.mockResolvedValueOnce(payment({ prospect: { id: 7, brandId: 1, status: 'closed_won', packageId: null, seatsReserved: 0 } }));
    await expect(call('post', '/payments/:id/reverse', { params: { id: '50' }, body: { reason: 'Keliru' } })).rejects.toMatchObject({ status: 409 });
    mocks.paymentFindUnique.mockResolvedValueOnce(payment({ status: 'reversed' }));
    await expect(call('post', '/payments/:id/reverse', { params: { id: '50' }, body: { reason: 'Keliru' } })).rejects.toMatchObject({ status: 409 });
    expect(mocks.paymentUpdateMany).not.toHaveBeenCalled();
  });
});
