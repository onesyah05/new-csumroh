import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

/**
 * Handler-level tests for the closing criteria of the re-audit (R01–R05, R07).
 * The real Express handlers run against an in-memory store that mimics the MySQL
 * semantics the handlers rely on: conditional `updateMany` counts, unique keys (P2002),
 * row-level serialization of transactions and rollback on error.
 * Authentication, browser rendering and real InnoDB locking are out of scope.
 */

type Row = Record<string, any>;
const mocks = vi.hoisted(() => ({
  state: { prospects: new Map<number, Row>(), packages: new Map<number, Row>(), payments: [] as Row[], logs: [] as Row[], messages: [] as Row[], users: [] as Row[] },
  capi: vi.fn(),
  send: vi.fn(),
  conversations: vi.fn(),
  emit: vi.fn(),
}));

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return cond.in.includes(value);
      if ('notIn' in cond) return !cond.notIn.includes(value);
      if ('gte' in cond) return value !== null && value >= cond.gte;
      if ('not' in cond) return value !== cond.not;
      if ('OR' in cond) return true;
      return true;
    }
    if (key === 'OR') {
      return (cond as Row[]).some((alt) => matches(row, alt));
    }
    return value === cond;
  });
}

function apply(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) row[key] = Number(row[key] ?? 0) + Number(value.increment);
    else if (value && typeof value === 'object' && 'decrement' in value) row[key] = Number(row[key] ?? 0) - Number(value.decrement);
    else row[key] = value;
  }
  return row;
}

const db = vi.hoisted(() => {
  const s = () => mocks.state;
  const copy = (r?: Row) => (r ? structuredClone(r) : null);
  let tail: Promise<unknown> = Promise.resolve();
  const client: any = {
    prospect: {
      findFirst: async ({ where }: any) => copy([...s().prospects.values()].find((p) => matches(p, where))),
      findUnique: async ({ where }: any) => copy(s().prospects.get(where.id)),
      findUniqueOrThrow: async ({ where }: any) => copy(s().prospects.get(where.id))!,
      findMany: async ({ where }: any) => [...s().prospects.values()].filter((p) => matches(p, where)).map((p) => copy(p)),
      update: async ({ where, data }: any) => copy(apply(s().prospects.get(where.id)!, data)),
      updateMany: async ({ where, data }: any) => {
        const rows = [...s().prospects.values()].filter((p) => matches(p, where));
        rows.forEach((r) => apply(r, data));
        return { count: rows.length };
      },
    },
    package: {
      findFirst: async ({ where }: any) => copy([...s().packages.values()].find((p) => matches(p, where))),
      findUnique: async ({ where }: any) => copy(s().packages.get(where.id)),
      updateMany: async ({ where, data }: any) => {
        const rows = [...s().packages.values()].filter((p) => matches(p, where));
        rows.forEach((r) => apply(r, data));
        return { count: rows.length };
      },
    },
    payment: {
      findUnique: async ({ where }: any) => copy(s().payments.find((p) => p.idempotencyKey === where.idempotencyKey)),
      findFirst: async ({ where }: any) => copy(s().payments.find((p) => matches(p, where))),
      create: async ({ data }: any) => {
        if (s().payments.some((p) => p.idempotencyKey === data.idempotencyKey)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test', meta: { target: 'payments_idempotency_key_key' } });
        }
        s().payments.push({ ...data });
        return data;
      },
    },
    prospectLog: { create: async ({ data }: any) => { s().logs.push(data); return data; } },
    user: {
      findUnique: async ({ where }: any) => copy(s().users.find((u) => u.id === where.id)),
      // Kelayakan PIC: CS aktif dengan brand utama yang sama (akses UserBrand tidak dimodelkan di sini).
      findFirst: async ({ where }: any) => copy(s().users.find((u) => u.id === where.id && u.isActive && u.role === where.role && u.brandId === 1)),
    },
    chatMessage: {
      count: async () => 1,
      findFirst: async ({ where }: any) => copy(s().messages.find((m) => matches(m, where))),
      findMany: async ({ where }: any) => s().messages.filter((m) => matches(m, where)).map((m) => copy(m)),
    },
    // Serialized like conflicting InnoDB row locks; state is rolled back when the callback throws.
    $transaction: (callback: any) => {
      const run = tail.then(async () => {
        const snapshot = structuredClone({ prospects: [...s().prospects], packages: [...s().packages], payments: s().payments, logs: s().logs });
        try {
          return await callback(client);
        } catch (error) {
          s().prospects = new Map(snapshot.prospects);
          s().packages = new Map(snapshot.packages);
          s().payments = snapshot.payments;
          s().logs = snapshot.logs;
          throw error;
        }
      });
      tail = run.catch(() => undefined);
      return run;
    },
  };
  return client;
});

vi.mock('../../db/prisma.js', () => ({ prisma: db }));
vi.mock('../../middleware/auth.js', () => ({
  authGuard: (_req: any, _res: any, next: any) => next(),
  scopedBrandId: (_req: any, requested?: number) => requested ?? 1,
}));
vi.mock('../../realtime/socket.js', () => ({ emitToBrand: mocks.emit }));
vi.mock('../capi/capi.service.js', () => ({ queueCapiForStatus: mocks.capi }));
vi.mock('../chat/chat.routes.js', () => ({ getLivechatConversationsForBrand: mocks.conversations }));
vi.mock('../chat/outbound.js', async (importOriginal) => ({ ...(await importOriginal<any>()), sendTextToProspect: mocks.send }));

import { prospectsRouter } from './prospects.routes.js';

function invoke(method: string, route: string, opts: { id?: number; body?: any; role?: string; query?: any; userId?: number } = {}) {
  const layer = (prospectsRouter as any).stack.find((l: any) => l.route?.path === route && l.route.methods[method]);
  if (!layer) throw new Error(`Route missing: ${method} ${route}`);
  return new Promise<any>((resolve) => {
    let status = 200;
    const res = { status: (s: number) => { status = s; return res; }, json: (data: any) => resolve({ status, ...data }) };
    const req = { params: { id: String(opts.id ?? 1) }, body: opts.body ?? {}, query: opts.query ?? {}, user: { id: opts.userId ?? 7, name: 'Test user', role: opts.role ?? 'cs', brandId: 1 } };
    layer.route.stack.at(-1).handle(req, res, (error: any) => resolve({ status: error.status ?? (error.name === 'ZodError' ? 422 : 500), error: error.message }));
  });
}

const prospect = (id: number) => mocks.state.prospects.get(id)!;
const quota = () => mocks.state.packages.get(1)!.quotaRemaining;

function seedProspect(id: number, overrides: Row = {}) {
  mocks.state.prospects.set(id, {
    id, brandId: 1, userId: 7, name: `Jamaah ${id}`, status: 'qualified', packageId: 1,
    dealValue: 60_000_000, dpAmount: 0, invoiceAmount: 0, paymentStatus: 'unpaid', dpPaidAt: null,
    paxQuad: 2, paxTriple: 0, paxDouble: 0, paxInfant: 0, closedWonCount: 0, seatsReserved: 0,
    targetMonth: 'Desember', roomPreference: 'quad', notes: null, invoiceNumber: null, invoiceSentAt: null,
    offerSentAt: null, verifiedByUserId: null, paymentProofUrl: null, nextFollowupDate: null,
    paymentProofMessageId: null, remoteJid: '6281234@s.whatsapp.net', phone: '6281234',
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.prospects = new Map();
  mocks.state.packages = new Map([[1, { id: 1, brandId: 1, name: 'Paket Uji', price: 'Rp 30.000.000', priceQuad: '', priceTriple: '', priceDouble: '', priceInfant: '', dp: '5000000', quotaRemaining: 10 }]]);
  mocks.state.payments = [];
  mocks.state.logs = [];
  mocks.state.messages = [];
  mocks.state.users = [
    { id: 7, name: 'CS Fitri', role: 'cs', isActive: true, brandId: 1 },
    { id: 8, name: 'CS Rahma', role: 'cs', isActive: true, brandId: 1 },
    { id: 9, name: 'CS Nonaktif', role: 'cs', isActive: false, brandId: 1 },
  ];
  seedProspect(1);
  mocks.send.mockResolvedValue({ messageId: 'WA-MSG-1' });
  mocks.conversations.mockResolvedValue([]);
});

describe('R04 profile save', () => {
  it('CS saves notes from the detail page even when the payload echoes unchanged settlement fields', async () => {
    const result = await invoke('patch', '/:id/profile', { body: { notes: 'Follow up besok', dealValue: 60_000_000, dpAmount: 0, paymentStatus: 'unpaid' } });
    expect(result.status).toBe(200);
    expect(prospect(1).notes).toBe('Follow up besok');
    expect(prospect(1).dpAmount).toBe(0);
  });

  it('rejects any attempt to change settlement through the profile, for every role', async () => {
    for (const role of ['cs', 'admin', 'finance']) {
      const result = await invoke('patch', '/:id/profile', { body: { dpAmount: 10_000_000 }, role });
      expect(result.status).toBe(403);
    }
    expect(prospect(1).dpAmount).toBe(0);
  });

  it('locks package and pax of a verified deal', async () => {
    prospect(1).status = 'deal';
    const result = await invoke('patch', '/:id/profile', { body: { paxQuad: 4 } });
    expect(result.status).toBe(409);
    expect(prospect(1).paxQuad).toBe(2);
  });
});

describe('R01 invoice and offer never touch verified cash', () => {
  it('draft invoice after a 5M verified DP keeps cash at 5M and records the bill separately', async () => {
    Object.assign(prospect(1), { status: 'deal', dpAmount: 5_000_000, paymentStatus: 'partial_dp', verifiedByUserId: 9 });
    const result = await invoke('post', '/:id/invoice', { body: { invoiceAmount: 10_000_000, sendViaWhatsApp: false } });
    expect(result.status).toBe(200);
    expect(prospect(1).dpAmount).toBe(5_000_000);
    expect(prospect(1).invoiceAmount).toBe(10_000_000);
    expect(prospect(1).status).toBe('deal');
    expect(prospect(1).invoiceSentAt).toBeNull();
  });

  it('prices the offer from the catalog and ignores a CS-supplied value', async () => {
    const result = await invoke('post', '/:id/offer', { body: { packageId: 1, dealValue: 1, sendViaWhatsApp: false } });
    expect(result.status).toBe(200);
    expect(prospect(1).dealValue).toBe(60_000_000);
  });

  it('refuses to re-offer a booking that is already a deal', async () => {
    prospect(1).status = 'deal';
    const result = await invoke('post', '/:id/offer', { body: { packageId: 1, sendViaWhatsApp: false } });
    expect(result.status).toBe(409);
  });
});

describe('R03 sent means delivered by the gateway', () => {
  it('failed delivery leaves no sent timestamp and no stage change', async () => {
    mocks.send.mockRejectedValue(Object.assign(new Error('WhatsApp belum terhubung'), { status: 502 }));
    const result = await invoke('post', '/:id/offer', { body: { packageId: 1, sendViaWhatsApp: true, messageText: 'Penawaran' } });
    expect(result.status).toBe(502);
    expect(prospect(1).offerSentAt).toBeNull();
    expect(prospect(1).status).toBe('qualified');
    expect(mocks.capi).not.toHaveBeenCalled();
  });

  it('successful delivery records the WhatsApp message id, then promotes the stage', async () => {
    const result = await invoke('post', '/:id/offer', { body: { packageId: 1, sendViaWhatsApp: true, messageText: 'Penawaran' } });
    expect(result.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ prospectId: 1, text: 'Penawaran' }));
    expect(prospect(1).offerMessageId).toBe('WA-MSG-1');
    expect(prospect(1).offerSentAt).toBeInstanceOf(Date);
    expect(prospect(1).status).toBe('offer');
  });

  it('a request without the flag is a draft', async () => {
    await invoke('post', '/:id/invoice', { body: { invoiceAmount: 10_000_000 } });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(prospect(1).invoiceSentAt).toBeNull();
    expect(prospect(1).status).toBe('qualified');
  });

  it('closing cannot be set manually before an invoice was actually delivered', async () => {
    prospect(1).invoiceNumber = 'INV/202609/0001';
    const result = await invoke('patch', '/:id/status', { body: { status: 'closing' } });
    expect(result.status).toBe(422);
  });
});

describe('R02 payment verification', () => {
  const body = { approvedAmount: 5_000_000, bankName: 'BSI', mutationDate: '2026-09-23' };

  it('two identical concurrent approvals record one payment, one win, and consume seats once', async () => {
    const results = await Promise.all([
      invoke('post', '/:id/verify-payment', { body, role: 'finance' }),
      invoke('post', '/:id/verify-payment', { body, role: 'finance' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(mocks.state.payments).toHaveLength(1);
    expect(quota()).toBe(8);
    expect(prospect(1).closedWonCount).toBe(1);
    expect(prospect(1).dpAmount).toBe(5_000_000);
    expect(mocks.capi).toHaveBeenCalledTimes(1);
  });

  it('two families racing for the last seats: only one booking succeeds and quota never goes negative', async () => {
    mocks.state.packages.get(1)!.quotaRemaining = 2;
    seedProspect(2);
    const results = await Promise.all([
      invoke('post', '/:id/verify-payment', { id: 1, body, role: 'finance' }),
      invoke('post', '/:id/verify-payment', { id: 2, body: { ...body, referenceNo: 'REF-B' }, role: 'finance' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(quota()).toBe(0);
    const losers = [prospect(1), prospect(2)].filter((p) => p.status !== 'deal');
    expect(losers).toHaveLength(1);
    expect(losers[0]!.dpAmount).toBe(0);
    expect(mocks.state.payments).toHaveLength(1);
  });

  it('DP then settlement accumulates cash, marks paid_full, and fires Purchase once', async () => {
    await invoke('post', '/:id/verify-payment', { body: { ...body, idempotencyKey: 'form-open-1' }, role: 'finance' });
    const second = await invoke('post', '/:id/verify-payment', { body: { ...body, approvedAmount: 55_000_000, idempotencyKey: 'form-open-2' }, role: 'finance' });
    expect(second.status).toBe(200);
    expect(prospect(1).dpAmount).toBe(60_000_000);
    expect(prospect(1).paymentStatus).toBe('paid_full');
    expect(prospect(1).closedWonCount).toBe(1);
    expect(quota()).toBe(8);
    expect(mocks.state.payments.map((p) => p.amount)).toEqual([5_000_000, 55_000_000]);
    expect(mocks.capi).toHaveBeenCalledTimes(1);
  });

  it('CS cannot verify and insufficient quota blocks verification without side effects', async () => {
    expect((await invoke('post', '/:id/verify-payment', { body })).status).toBe(403);
    mocks.state.packages.get(1)!.quotaRemaining = 1;
    const result = await invoke('post', '/:id/verify-payment', { body, role: 'finance' });
    expect(result.status).toBe(409);
    expect(prospect(1).status).toBe('qualified');
    expect(mocks.state.payments).toHaveLength(0);
  });

  it('a verified deal cannot fall back into the pipeline; cancellation releases its seats', async () => {
    await invoke('post', '/:id/verify-payment', { body, role: 'finance' });
    expect((await invoke('patch', '/:id/status', { body: { status: 'offer' } })).status).toBe(422);
    expect((await invoke('patch', '/:id/status', { body: { status: 'lose', lostReason: 'Batal' } })).status).toBe(403);
    const cancel = await invoke('patch', '/:id/status', { body: { status: 'lose', lostReason: 'Batal berangkat' }, role: 'finance' });
    expect(cancel.status).toBe(200);
    expect(quota()).toBe(10);
    expect(prospect(1).seatsReserved).toBe(0);
  });
});

describe('R05 legacy proof endpoint', () => {
  it('rejects inline base64 data URLs', async () => {
    const result = await invoke('post', '/:id/payment-proof', { body: { paymentProofUrl: 'data:image/png;base64,' + 'A'.repeat(70_000) } });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(prospect(1).paymentProofUrl).toBeNull();
  });
});

describe('R07 follow-up filters', () => {
  it('today/overdue read Prisma DATE values in WIB', async () => {
    const todayWib = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
    mocks.conversations.mockResolvedValue([
      { ...prospect(1), id: 1, nextFollowupDate: new Date(`${todayWib}T00:00:00.000Z`), remoteJid: 'a@s.whatsapp.net' },
      { ...prospect(1), id: 2, nextFollowupDate: new Date('2020-01-01T00:00:00.000Z'), remoteJid: 'b@s.whatsapp.net' },
      { ...prospect(1), id: 3, status: 'deal', nextFollowupDate: new Date('2020-01-01T00:00:00.000Z'), remoteJid: 'c@s.whatsapp.net' },
    ]);
    expect((await invoke('get', '/', { query: { filter: 'today' } })).data.map((p: Row) => p.id)).toEqual([1]);
    expect((await invoke('get', '/', { query: { filter: 'overdue' } })).data.map((p: Row) => p.id)).toEqual([2]);
  });
});

describe('Bukti transfer langsung dari chat WhatsApp', () => {
  const originalCwd = process.cwd();
  let tmp = '';
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);

  beforeAll(() => {
    // Direktori kerja sementara: berkas media uji dan salinan bukti tidak menyentuh uploads/storage asli.
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-from-chat-'));
    fs.mkdirSync(path.join(tmp, 'uploads', 'media'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'uploads', 'media', 'tf.jpg'), JPEG);
    fs.writeFileSync(path.join(tmp, 'uploads', 'media', 'note.txt'), 'bukan gambar');
    process.chdir(tmp);
  });
  afterAll(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const message = (overrides: Row = {}) => ({
    id: 50, brandId: 1, prospectId: 1, messageId: 'WA-IN-50', remoteJid: '6281234@s.whatsapp.net', phone: '6281234',
    isFromMe: false, isDeleted: false, messageType: 'imageMessage', mediaUrl: '/uploads/media/tf.jpg', ...overrides,
  });

  it('copies the chat image into private proof storage and links the source message', async () => {
    mocks.state.messages = [message()];
    const result = await invoke('post', '/:id/payment-proof-from-message', { body: { messageId: 50 } });
    expect(result.status).toBe(200);
    expect(prospect(1).paymentProofUrl).toMatch(/^\/api\/v1\/prospects\/payment-proof-file\/proof-1-\d+-[a-f0-9]+\.jpg$/);
    expect(prospect(1).paymentProofMessageId).toBe('WA-IN-50');
    const stored = path.join(tmp, 'storage', 'private', 'proofs', path.basename(prospect(1).paymentProofUrl));
    expect(fs.readFileSync(stored).equals(JPEG)).toBe(true);
    expect(mocks.emit).toHaveBeenCalledWith(1, 'finance:payment_proof_new', expect.objectContaining({ prospectId: 1 }));
  });

  it('the verified payment remembers which message was used as proof', async () => {
    mocks.state.messages = [message()];
    await invoke('post', '/:id/payment-proof-from-message', { body: { messageId: 50 } });
    await invoke('post', '/:id/verify-payment', { body: { approvedAmount: 5_000_000, bankName: 'BSI' }, role: 'finance' });
    expect(mocks.state.payments[0]).toMatchObject({ proofMessageId: 'WA-IN-50', proofUrl: prospect(1).paymentProofUrl });
  });

  it('rejects messages from another conversation, text files, and outbound-only text', async () => {
    mocks.state.messages = [
      message({ id: 51, prospectId: 9, remoteJid: '629999@s.whatsapp.net', phone: '629999' }),
      message({ id: 52, mediaUrl: '/uploads/media/note.txt', messageType: 'documentMessage' }),
      message({ id: 53, messageType: 'conversation', mediaUrl: null }),
    ];
    expect((await invoke('post', '/:id/payment-proof-from-message', { body: { messageId: 51 } })).status).toBe(422);
    expect((await invoke('post', '/:id/payment-proof-from-message', { body: { messageId: 52 } })).status).toBe(400);
    expect((await invoke('post', '/:id/payment-proof-from-message', { body: { messageId: 53 } })).status).toBe(422);
    expect(prospect(1).paymentProofUrl).toBeNull();
  });

  it('refuses media paths outside uploads', async () => {
    mocks.state.messages = [message({ mediaUrl: '/uploads/../.env' })];
    expect((await invoke('post', '/:id/payment-proof-from-message', { body: { messageId: 50 } })).status).toBe(404);
  });
});

describe('PIC: hanya PIC atau Admin yang mengubah prospek', () => {
  it('CS lain ditolak untuk status, profil, keberatan, follow-up, dan bukti transfer', async () => {
    const asOther = { userId: 8 };
    expect((await invoke('patch', '/:id/status', { ...asOther, body: { status: 'lose', lostReason: 'Batal' } })).status).toBe(403);
    expect((await invoke('patch', '/:id/profile', { ...asOther, body: { notes: 'x' } })).status).toBe(403);
    expect((await invoke('post', '/:id/objection', { ...asOther, body: { category: 'price', notes: 'mahal' } })).status).toBe(403);
    expect((await invoke('post', '/:id/activities', { ...asOther, body: { type: 'call', note: 'telepon' } })).status).toBe(403);
    const proof = await invoke('post', '/:id/payment-proof-upload', { ...asOther, body: { image: Buffer.from('x').toString('base64') } });
    expect(proof.status).toBe(403);
    expect(proof.error).toContain('CS Fitri');
    expect(prospect(1).status).toBe('qualified');
    expect(prospect(1).notes).toBeNull();
  });

  it('PIC, Admin, dan CS pada prospek tanpa PIC tetap boleh', async () => {
    expect((await invoke('patch', '/:id/profile', { body: { notes: 'PIC' } })).status).toBe(200);
    expect((await invoke('patch', '/:id/profile', { userId: 99, role: 'admin', body: { notes: 'Admin' } })).status).toBe(200);
    prospect(1).userId = null;
    expect((await invoke('patch', '/:id/profile', { userId: 8, body: { notes: 'Antrean' } })).status).toBe(200);
  });

  it('Finance hanya pada tugas Finance: follow-up boleh, profil dan keberatan tidak', async () => {
    expect((await invoke('post', '/:id/activities', { userId: 20, role: 'finance', body: { type: 'call', note: 'Pelunasan' } })).status).toBe(201);
    expect((await invoke('patch', '/:id/profile', { userId: 20, role: 'finance', body: { notes: 'x' } })).status).toBe(403);
    expect((await invoke('post', '/:id/objection', { userId: 20, role: 'finance', body: { category: 'price', notes: 'x' } })).status).toBe(403);
  });
});

describe('PIC: klaim, tugaskan, dan serahkan', () => {
  it('klaim pertama menang, klaim kedua 409; duplikat nomor yang sama ikut ke PIC baru', async () => {
    prospect(1).userId = null;
    seedProspect(2, { userId: null, remoteJid: '6281234@lid', phone: '081234' });
    const first = await invoke('post', '/:id/claim', { userId: 8 });
    expect(first.status).toBe(200);
    expect(prospect(1).userId).toBe(8);
    expect(prospect(2).userId).toBe(8);
    expect((await invoke('post', '/:id/claim', { userId: 7 })).status).toBe(409);
    expect(prospect(1).userId).toBe(8);
  });

  it('prospek Deal atau Batal tidak bisa diklaim', async () => {
    prospect(1).userId = null;
    prospect(1).status = 'lose';
    expect((await invoke('post', '/:id/claim', { userId: 8 })).status).toBe(409);
    expect(prospect(1).userId).toBeNull();
  });

  it('PIC menyerahkan ke CS lain dengan alasan; CS bukan PIC ditolak', async () => {
    expect((await invoke('post', '/:id/handover', { userId: 8, body: { targetUserId: 8, reason: 'ambil alih' } })).status).toBe(403);
    const result = await invoke('post', '/:id/handover', { body: { targetUserId: 8, reason: 'Cuti seminggu' } });
    expect(result.status).toBe(200);
    expect(prospect(1).userId).toBe(8);
    expect(mocks.state.logs.at(-1)).toMatchObject({ actionType: 'pic_handover' });
  });

  it('serahkan ke diri sendiri atau CS nonaktif ditolak', async () => {
    expect((await invoke('post', '/:id/handover', { body: { targetUserId: 7, reason: 'sama' } })).status).toBe(422);
    expect((await invoke('post', '/:id/handover', { body: { targetUserId: 9, reason: 'nonaktif' } })).status).toBe(400);
    expect(prospect(1).userId).toBe(7);
  });

  it('Admin menugaskan PIC; CS tidak bisa menugaskan', async () => {
    expect((await invoke('post', '/:id/assign', { body: { userId: 8 } })).status).toBe(403);
    expect((await invoke('post', '/:id/assign', { userId: 99, role: 'admin', body: { userId: 8 } })).status).toBe(200);
    expect(prospect(1).userId).toBe(8);
  });
});

describe('PIC: ambil alih setelah 15 menit belum dibalas', () => {
  const minutesAgo = (m: number) => Math.floor(Date.now() / 1000) - m * 60;
  const chat = (id: number, isFromMe: boolean, at: number) =>
    ({ id, prospectId: 1, brandId: 1, isFromMe, timestamp: at, isDeleted: false, messageType: 'conversation' });

  it('CS lain mengambil alih bila pesan jamaah pertama yang belum dibalas sudah lebih dari 15 menit', async () => {
    mocks.state.messages = [chat(1, true, minutesAgo(40)), chat(2, false, minutesAgo(20)), chat(3, false, minutesAgo(2))];
    const result = await invoke('post', '/:id/takeover', { userId: 8 });
    expect(result.status).toBe(200);
    expect(prospect(1).userId).toBe(8);
    expect(mocks.state.logs.at(-1)).toMatchObject({ actionType: 'pic_taken_over', title: 'PIC diambil alih oleh CS Rahma dari CS Fitri' });
    expect(mocks.emit).toHaveBeenCalledWith(1, 'prospect:claimed', expect.objectContaining({ userId: 8, takenOverFrom: 7 }));
  });

  it('belum 15 menit, atau pesan terakhir dari CS: prospek tetap milik PIC', async () => {
    mocks.state.messages = [chat(1, false, minutesAgo(10))];
    const early = await invoke('post', '/:id/takeover', { userId: 8 });
    expect(early.status).toBe(409);
    expect(early.error).toContain('15 menit');
    mocks.state.messages = [chat(1, false, minutesAgo(60)), chat(2, true, minutesAgo(30))];
    expect((await invoke('post', '/:id/takeover', { userId: 8 })).status).toBe(409);
    expect(prospect(1).userId).toBe(7);
  });

  it('hanya CS aktif; bukan untuk PIC sendiri, prospek tanpa PIC, atau Deal/Batal', async () => {
    mocks.state.messages = [chat(1, false, minutesAgo(60))];
    expect((await invoke('post', '/:id/takeover', { userId: 99, role: 'admin' })).status).toBe(403);
    expect((await invoke('post', '/:id/takeover', { userId: 9 })).status).toBe(403);
    expect((await invoke('post', '/:id/takeover', { userId: 7 })).status).toBe(409);
    prospect(1).status = 'deal';
    expect((await invoke('post', '/:id/takeover', { userId: 8 })).status).toBe(409);
    prospect(1).status = 'qualified';
    prospect(1).userId = null;
    expect((await invoke('post', '/:id/takeover', { userId: 8 })).status).toBe(409);
  });
});
