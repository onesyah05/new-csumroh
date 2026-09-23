import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const mocks = vi.hoisted(() => ({
  prospectFindMany: vi.fn(),
  messageFindMany: vi.fn(),
}));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    prospect: { findMany: mocks.prospectFindMany },
    chatMessage: { findMany: mocks.messageFindMany },
  },
}));
vi.mock('../../middleware/auth.js', () => ({
  authGuard: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  scopedBrandId: (_req: any, requested?: number) => requested ?? 1,
}));

import { verificationRouter } from './verification.routes.js';

function queue(query: Row = {}) {
  const layer = (verificationRouter as any).stack.find((l: any) => l.route?.path === '/queue');
  return new Promise<any>((resolve, reject) => {
    const res = { json: (body: any) => resolve(body.data), status: () => res };
    layer.route.stack.at(-1).handle({ query, user: { id: 1, role: 'finance' } }, res, reject);
  });
}

const invoiceAt = new Date('2026-09-20T03:00:00.000Z');
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const base = (id: number, overrides: Row = {}): Row => ({
  id, name: `Jamaah ${id}`, status: 'closing', paymentStatus: 'unpaid', invoiceSentAt: invoiceAt,
  paymentProofUrl: null, paymentProofMessageId: null, payments: [], ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Antrean verifikasi Finance', () => {
  it('lists proofs not yet used by a verified payment, including settlement proofs on deals', async () => {
    const pending = base(1, { paymentProofUrl: '/p/a.jpg' });
    const verified = base(2, { paymentProofUrl: '/p/b.jpg', payments: [{ proofUrl: '/p/b.jpg', createdAt: invoiceAt }] });
    const settlement = base(3, { status: 'deal', paymentStatus: 'partial_dp', paymentProofUrl: '/p/c2.jpg', payments: [{ proofUrl: '/p/c1.jpg', createdAt: invoiceAt }] });
    mocks.prospectFindMany.mockResolvedValueOnce([pending, verified, settlement]).mockResolvedValueOnce([]);
    const data = await queue();
    expect(data.submitted.map((p: Row) => p.id)).toEqual([1, 3]);
    expect(data.submitted[0]).not.toHaveProperty('payments');
  });

  it('suggests only inbound media sent after the invoice or last payment, never already-used messages', async () => {
    const billed = base(4, { payments: [] });
    const paidOnce = base(5, { status: 'deal', paymentStatus: 'partial_dp', payments: [{ proofUrl: '/p/x.jpg', proofMessageId: 'M-OLD', createdAt: new Date('2026-09-21T03:00:00.000Z') }] });
    mocks.prospectFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([billed, paidOnce]);
    mocks.messageFindMany.mockResolvedValue([
      { id: 10, prospectId: 4, messageId: 'M-AFTER', timestamp: sec('2026-09-20T05:00:00.000Z') },
      { id: 11, prospectId: 4, messageId: 'M-BEFORE', timestamp: sec('2026-09-19T05:00:00.000Z') },
      { id: 12, prospectId: 5, messageId: 'M-OLD', timestamp: sec('2026-09-21T04:00:00.000Z') },
      { id: 13, prospectId: 5, messageId: 'M-BEFORE-PAYMENT', timestamp: sec('2026-09-20T05:00:00.000Z') },
    ]);
    const data = await queue({ brandId: '2' });
    expect(data.candidates.map((p: Row) => [p.id, p.candidateMessages.map((m: Row) => m.messageId)])).toEqual([[4, ['M-AFTER']]]);
    // Scope brand diteruskan ke query.
    expect(mocks.prospectFindMany.mock.calls[0]![0].where.brandId).toBe(2);
  });

  it('a prospect with a pending proof is not also shown as a candidate', async () => {
    const pending = base(6, { paymentProofUrl: '/p/a.jpg' });
    mocks.prospectFindMany.mockResolvedValueOnce([pending]).mockResolvedValueOnce([pending]);
    mocks.messageFindMany.mockResolvedValue([{ id: 20, prospectId: 6, messageId: 'M-NEW', timestamp: sec('2026-09-22T00:00:00.000Z') }]);
    const data = await queue();
    expect(data.submitted).toHaveLength(1);
    expect(data.candidates).toHaveLength(0);
  });
});
