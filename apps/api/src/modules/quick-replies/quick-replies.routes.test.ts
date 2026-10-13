import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  brandFind: vi.fn(), prospectFind: vi.fn(), packageFind: vi.fn(),
}));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    quickReply: { findMany: mocks.findMany, findUnique: mocks.findUnique, create: mocks.create, update: mocks.update, delete: mocks.delete },
    brand: { findUniqueOrThrow: mocks.brandFind },
    prospect: { findFirst: mocks.prospectFind },
    package: { findFirst: mocks.packageFind },
  },
}));
vi.mock('../../middleware/auth.js', async () => {
  const actual = await vi.importActual<typeof import('../../middleware/auth.js')>('../../middleware/auth.js');
  return { ...actual, authGuard: (_req: unknown, _res: unknown, next: () => void) => next() };
});

import { quickRepliesRouter } from './quick-replies.routes.js';

type Actor = { id: number; role: string; brandId: number | null; name: string };
const cs = (id = 7): Actor => ({ id, role: 'cs', brandId: 1, name: 'Fitri' });
const admin: Actor = { id: 1, role: 'admin', brandId: 1, name: 'Admin' };

function call(method: 'get' | 'post' | 'patch' | 'delete', path: string, user: Actor, opts: { body?: unknown; params?: Record<string, string>; query?: Record<string, string> } = {}) {
  const layer = (quickRepliesRouter as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
  return new Promise<{ status: number; body?: any; error?: any }>((resolve) => {
    const res: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(body: any) { resolve({ status: this.statusCode, body }); } };
    layer.route.stack.at(-1).handle(
      { params: opts.params ?? {}, body: opts.body ?? {}, query: opts.query ?? {}, user },
      res,
      (error: any) => resolve({ status: error?.status ?? 500, error }),
    );
  });
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 5, brandId: 1, scope: 'brand', ownerId: 7, title: 'Sapaan', shortcut: 'halo', body: 'Halo {{nama}}, saya {{cs_name}} dari {{travel}}.', updatedAt: new Date(), ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe('Balas cepat', () => {
  it('daftar: hanya template brand dan milik sendiri; token terisi dari prospek, sisanya dilaporkan', async () => {
    mocks.findMany.mockResolvedValue([row({ body: 'Halo {{nama}}, paket {{paket}} dari {{travel}}.' })]);
    mocks.brandFind.mockResolvedValue({ id: 1, name: 'Hana Tours', ppiuNumber: null, bankName: null, bankAccountNumber: null, bankAccountHolder: null, address: null, gmapsUrl: null });
    mocks.prospectFind.mockResolvedValue({ id: 11, brandId: 1, name: 'Ibu Aisyah Rahma', packageId: null, paxQuad: 0, paxTriple: 0, paxDouble: 0, paxInfant: 0, targetMonth: null, budgetRange: null, city: null, nextFollowupDate: null, offerSentAt: null, dealValue: 0 });
    const result = await call('get', '/', cs(), { query: { brandId: '1', prospectId: '11' } });
    expect(result.status).toBe(200);
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ brandId: 1, OR: [{ scope: 'brand' }, { scope: 'personal', ownerId: 7 }] });
    expect(result.body.data[0].text).toBe('Halo Ibu, paket {{paket}} dari Hana Tours.');
    expect(result.body.data[0].missing).toEqual(['paket']);
  });

  it('buat: pintasan tidak boleh memakai spasi atau garis miring', async () => {
    mocks.create.mockImplementation(async ({ data }: any) => row(data));
    const bad = await call('post', '/', cs(), { body: { brandId: 1, scope: 'brand', title: 'Sapaan', shortcut: 'ha lo', body: 'Halo' } });
    expect(bad.error?.name).toBe('ZodError');
    const ok = await call('post', '/', cs(), { body: { brandId: 1, scope: 'personal', title: ' Sapaan ', shortcut: 'halo', body: ' Halo ' } });
    expect(ok.status).toBe(201);
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ brandId: 1, scope: 'personal', ownerId: 7, title: 'Sapaan', shortcut: 'halo', body: 'Halo' });
  });

  it('baris baru dan emoji di isi pesan tersimpan apa adanya (hanya tepi yang dipangkas)', async () => {
    mocks.create.mockImplementation(async ({ data }: any) => row(data));
    const body = '  Assalamualaikum 🕋\n\nSaya {{cs_name}}\nSiap membantu 🙏  ';
    const ok = await call('post', '/', cs(), { body: { brandId: 1, scope: 'brand', title: 'Sapaan', body } });
    expect(ok.status).toBe(201);
    const saved = mocks.create.mock.calls.at(-1)![0].data.body as string;
    expect(saved).toBe(body.trim());
    expect(saved).toContain('\n\n');
    expect(saved).toContain('🕋');
  });

  it('template brand diubah siapa saja di brand itu; template pribadi orang lain tidak ditemukan', async () => {
    mocks.update.mockImplementation(async ({ data }: any) => row(data));
    mocks.findUnique.mockResolvedValue(row({ scope: 'brand', ownerId: 7 }));
    expect((await call('patch', '/:id', cs(8), { params: { id: '5' }, body: { body: 'Baru' } })).status).toBe(200);
    mocks.findUnique.mockResolvedValue(row({ scope: 'personal', ownerId: 7 }));
    expect((await call('patch', '/:id', cs(8), { params: { id: '5' }, body: { body: 'Baru' } })).status).toBe(404);
    expect((await call('patch', '/:id', cs(7), { params: { id: '5' }, body: { body: 'Baru' } })).status).toBe(200);
  });

  it('hapus brand: pembuat atau Admin; hapus pribadi: pemilik', async () => {
    mocks.delete.mockResolvedValue({});
    mocks.findUnique.mockResolvedValue(row({ scope: 'brand', ownerId: 7 }));
    expect((await call('delete', '/:id', cs(8), { params: { id: '5' } })).status).toBe(403);
    expect((await call('delete', '/:id', cs(7), { params: { id: '5' } })).status).toBe(200);
    expect((await call('delete', '/:id', admin, { params: { id: '5' } })).status).toBe(200);
    mocks.findUnique.mockResolvedValue(row({ scope: 'personal', ownerId: 7 }));
    expect((await call('delete', '/:id', admin, { params: { id: '5' } })).status).toBe(404);
  });
});
