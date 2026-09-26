import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const state = vi.hoisted(() => ({ requests: [] as Row[], prospects: [] as Row[], logs: [] as Row[], notified: [] as string[] }));

vi.mock('../../db/prisma.js', () => {
  const find = (rows: Row[], where: Row = {}) => rows.filter((row) => Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && 'not' in cond) return row[key] !== cond.not;
    if (cond && typeof cond === 'object' && 'in' in cond) return cond.in.includes(row[key]);
    return row[key] === cond;
  }));
  const withRelations = (row?: Row) => row && ({ ...row, prospect: state.prospects.find((p) => p.id === row.prospectId), brand: { id: row.brandId, name: 'Brand Uji' } });
  const db: any = {
    customRequest: {
      findFirst: async ({ where }: any) => [...find(state.requests, where)].reverse()[0] ?? null,
      findUnique: async ({ where }: any) => withRelations(state.requests.find((r) => r.id === where.id)) ?? null,
      findMany: async ({ where }: any) => find(state.requests, where).map(withRelations),
      groupBy: async () => [],
      create: async ({ data }: any) => { const row = { id: state.requests.length + 1, updatedAt: new Date(), ...data }; state.requests.push(row); return row; },
      update: async ({ where, data }: any) => {
        const row = state.requests.find((r) => r.id === where.id)!;
        Object.assign(row, data, { updatedAt: new Date(Date.now() + state.requests.length) });
        return { ...row };
      },
    },
    prospect: {
      findFirst: async ({ where }: any) => state.prospects.find((p) => p.id === where.id) ?? null,
      update: async ({ where, data }: any) => Object.assign(state.prospects.find((p) => p.id === where.id)!, data),
    },
    package: {
      findFirst: async ({ where }: any) => (where.id === 5 && where.brandId === 1 ? { id: 5, departureDate: new Date('2026-12-24T00:00:00.000Z') } : null),
      findUnique: async () => ({ name: 'Umroh Akhir Tahun' }),
    },
    prospectLog: { create: async ({ data }: any) => { state.logs.push(data); return data; } },
    user: { findUnique: async ({ where }: any) => ({ id: where.id, name: 'CS Fitri' }) },
  };
  db.$transaction = async (fn: any) => fn(db);
  return { prisma: db };
});
vi.mock('../../realtime/socket.js', () => ({ emitToBrand: vi.fn() }));
vi.mock('../capi/capi.service.js', () => ({ queueCapiForStatus: vi.fn() }));
vi.mock('../notifications/notification.events.js', () => ({
  dispatch: (task: () => unknown) => void task(),
  notifyCustomSubmitted: async (input: any) => { state.notified.push(input.revision ? 'revision' : 'submitted'); },
  notifyCustomQuoted: async () => { state.notified.push('quoted'); },
  notifyCustomReturned: async () => { state.notified.push('returned'); },
  notifyCustomAgreed: async () => { state.notified.push('agreed'); },
  notifyCustomUpdated: async () => { state.notified.push('updated'); },
}));
vi.mock('../../middleware/auth.js', () => ({
  authGuard: (_req: any, _res: any, next: any) => next(),
  requireRole: (...roles: string[]) => (req: any, _res: any, next: any) => (roles.includes(req.user.role) ? next() : next(Object.assign(new Error('403'), { status: 403 }))),
  scopedBrandId: (req: any, brandId: number) => {
    if (req.user.role === 'product') throw Object.assign(new Error('403'), { status: 403 });
    return brandId;
  },
}));
import { customRouter } from './custom.routes.js';

const users = {
  cs: { id: 7, name: 'CS Fitri', role: 'cs', brandId: 1, userBrands: [] },
  other: { id: 8, name: 'CS Rahma', role: 'cs', brandId: 1, userBrands: [] },
  product: { id: 30, name: 'Tim LA Ana', role: 'product', brandId: null, userBrands: [] },
  product2: { id: 31, name: 'LA Budi', role: 'product', brandId: null, userBrands: [] },
};
function call(method: string, path: string, opts: { user?: Row; params?: Row; body?: Row } = {}) {
  const layer = (customRouter as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
  if (!layer) throw new Error(`missing ${method} ${path}`);
  const handlers = layer.route.stack.map((s: any) => s.handle);
  return new Promise<any>((resolve) => {
    let status = 200;
    const req = { params: opts.params ?? {}, body: opts.body ?? {}, query: {}, user: opts.user ?? users.cs };
    const res = { status: (s: number) => { status = s; return res; }, json: (data: any) => resolve({ status, ...data }) };
    const run = (i: number) => handlers[i](req, res, (error?: any) => (error ? resolve({ status: error.status ?? (error.name === 'ZodError' ? 422 : 500), error: error.message }) : run(i + 1)));
    run(0);
  });
}
const need = { mode: 'full', departureDate: '2027-02-10', paxQuad: 2, hotelMakkah: 'Fairmont', nightsMakkah: 5, hotelMadinah: 'Dar Al Taqwa', nightsMadinah: 4, flightType: 'direct', fastTrain: true, budgetPerPax: 35_000_000 };
const quote = { offeredPrices: { quad: 38_000_000 }, floorPrices: { quad: 35_000_000 }, minDpPerPax: 10_000_000 };

beforeEach(() => {
  state.requests = []; state.logs = []; state.notified = [];
  state.prospects = [{ id: 1, brandId: 1, userId: 7, name: 'Jamaah Uji', status: 'qualified', paxQuad: 1, paxTriple: 0, paxDouble: 0, paxInfant: 0, paymentProofUrl: null,
    targetMonth: '2027-02', budgetRange: '35–40 Juta', passportStatus: 'sudah_ada', invoiceSentAt: null, invoiceAmount: 0, invoiceNumber: null }];
});

describe('Layanan custom', () => {
  it('alur lengkap: CS kirim → Tim LA hitung → CS sepakati (tidak boleh di bawah harga terendah)', async () => {
    const created = await call('post', '/prospect/:prospectId', { params: { prospectId: '1' }, body: need });
    expect(created.status).toBe(201);
    expect(state.prospects[0]!.paxQuad).toBe(2);
    expect(state.notified).toEqual(['submitted']);
    expect(state.logs[0]!.description).toContain('Total 9 malam');

    // Tim LA tidak mengisi kebutuhan; CS tidak menghitung harga.
    expect((await call('post', '/prospect/:prospectId', { user: users.product, params: { prospectId: '1' }, body: need })).status).toBe(403);
    expect((await call('post', '/:id/quote', { params: { id: '1' }, body: quote })).status).toBe(403);
    expect((await call('post', '/:id/quote', { user: users.product, params: { id: '1' }, body: { ...quote, floorPrices: { quad: 40_000_000 } } })).status).toBe(422);
    expect((await call('post', '/:id/quote', { user: users.product, params: { id: '1' }, body: { ...quote, offeredPrices: {} } })).error).toContain('Quad');
    const quoted = await call('post', '/:id/quote', { user: users.product, params: { id: '1' }, body: quote });
    expect(quoted.status).toBe(200);
    expect(state.requests[0]!.status).toBe('quoted');
    // Total = harga per jamaah × jamaah per tipe kamar.
    expect(state.requests[0]!).toMatchObject({ offeredPrice: 76_000_000, floorPrice: 70_000_000, offeredPrices: { quad: 38_000_000 } });
    // Default berlaku 3 hari.
    expect(Math.round((state.requests[0]!.quoteValidUntil.getTime() - Date.now()) / 86_400_000)).toBe(3);
    expect(state.notified).toContain('quoted');

    const low = await call('post', '/:id/agree', { params: { id: '1' }, body: { agreedPrice: 69_000_000 } });
    expect(low.status).toBe(422);
    expect(low.error).toContain('di bawah harga terendah');
    expect((await call('post', '/:id/agree', { user: users.other, params: { id: '1' }, body: { agreedPrice: 72_000_000 } })).status).toBe(403);
    const ok = await call('post', '/:id/agree', { params: { id: '1' }, body: { agreedPrice: 72_000_000 } });
    expect(ok.status).toBe(200);
    expect(state.requests[0]!.status).toBe('agreed');
    expect(state.prospects[0]!.dealValue).toBe(72_000_000);
  });

  it('harga kedaluwarsa tidak bisa disepakati; hitung ulang mengosongkan kesepakatan dan memberi tahu Tim LA', async () => {
    await call('post', '/prospect/:prospectId', { params: { prospectId: '1' }, body: need });
    await call('post', '/:id/quote', { user: users.product, params: { id: '1' }, body: quote });
    state.requests[0]!.quoteValidUntil = new Date(Date.now() - 1000);
    expect((await call('post', '/:id/agree', { params: { id: '1' }, body: { agreedPrice: 72_000_000 } })).error).toContain('Masa berlaku');
    const revision = await call('post', '/:id/revision', { params: { id: '1' }, body: { note: 'Harga kedaluwarsa, jamaah masih berminat' } });
    expect(revision.status).toBe(200);
    expect(state.requests[0]!.status).toBe('revision_requested');
    expect(state.notified.at(-1)).toBe('revision');
    expect(state.logs.at(-1)!.description).toContain('Harga terendah');
  });

  it('satu permintaan aktif per prospek; kebutuhan dikunci setelah dihitung; paket dasar harus dari brand yang sama', async () => {
    expect((await call('post', '/prospect/:prospectId', { params: { prospectId: '1' }, body: { ...need, paxQuad: 0 } })).status).toBe(422);
    expect((await call('post', '/prospect/:prospectId', { params: { prospectId: '1' }, body: { ...need, departureDate: '' } })).status).toBe(422);
    expect((await call('post', '/prospect/:prospectId', { params: { prospectId: '1' }, body: { ...need, basePackageId: 99 } })).status).toBe(404);
    await call('post', '/prospect/:prospectId', { params: { prospectId: '1' }, body: { ...need, basePackageId: 5 } });
    expect((await call('post', '/prospect/:prospectId', { params: { prospectId: '1' }, body: need })).status).toBe(409);
    expect((await call('patch', '/:id', { params: { id: '1' }, body: { ...need, paxQuad: 3 } })).status).toBe(200);
    await call('post', '/:id/quote', { user: users.product, params: { id: '1' }, body: quote });
    // Setelah dihitung, mengubah kebutuhan = otomatis minta hitung ulang dengan ringkasan perubahan.
    const changed = await call('patch', '/:id', { params: { id: '1' }, body: { ...need, paxQuad: 3, hotelMadinah: 'Pullman' } });
    expect(changed.status).toBe(200);
    expect(state.requests[0]!.status).toBe('revision_requested');
    // Ringkasan per label: nilai lama → baru.
    expect(state.requests[0]!.revisionNote).toContain('Madinah: Dar Al Taqwa, 4 malam → Pullman, 4 malam');
    expect(state.requests[0]!.revisionNote).not.toContain('Dihapus');
    expect(state.notified.at(-1)).toBe('revision');
  });

  it('berbasis paket: wajib pilih paket; tanggal ikut paket, isian pesawat/rute diabaikan; extend dicatat', async () => {
    const base = { mode: 'package', paxQuad: 2, extendNightsMakkah: 2, hotelMadinah: 'Pullman Zamzam', muthawif: true, servicesRemoved: ['Perlengkapan'], servicesAdded: ['Kereta cepat'], departureDate: '2027-05-01', airline: 'Garuda', route: 'makkah_first' };
    expect((await call('post', '/prospect/:prospectId', { params: { prospectId: '1' }, body: base })).status).toBe(422);
    const created = await call('post', '/prospect/:prospectId', { params: { prospectId: '1' }, body: { ...base, basePackageId: 5 } });
    expect(created.status).toBe(201);
    const row = state.requests[0]!;
    expect(row.departureDate.toISOString().slice(0, 10)).toBe('2026-12-24');
    expect(row.airline).toBeNull();
    expect(row.route).toBeNull();
    expect(row.extendNightsMakkah).toBe(2);
    expect(row.muthawif).toBeNull();
    expect(row.servicesAdded).toEqual(['Kereta cepat']);
    expect(state.logs[0]!.description).toContain('Berbasis paket: Umroh Akhir Tahun');
    expect(state.logs[0]!.description).toContain('Extend Makkah: +2 malam');
    expect(state.logs[0]!.description).toContain('Ganti hotel Madinah: Pullman Zamzam');
    expect(state.logs[0]!.description).toContain('Layanan dikurangi: Perlengkapan');
    expect(state.logs[0]!.description).toContain('Layanan ditambah: Kereta cepat');
  });

  it('full custom: tidak menyimpan isian extend; rentang tanggal divalidasi', async () => {
    expect((await call('post', '/prospect/:prospectId', { params: { prospectId: '1' }, body: { ...need, departureDateTo: '2027-02-01' } })).status).toBe(422);
    await call('post', '/prospect/:prospectId', { params: { prospectId: '1' }, body: { ...need, extendNightsMakkah: 3, departureDateTo: '2027-02-17' } });
    expect(state.requests[0]!.extendNightsMakkah).toBeNull();
    expect(state.requests[0]!.departureDateTo.toISOString().slice(0, 10)).toBe('2027-02-17');
    expect(state.logs[0]!.description).toContain('s.d. 17 Februari 2027');
  });

  it('Tim LA mengembalikan ke CS; CS melengkapi lalu otomatis masuk antrean lagi', async () => {
    await call('post', '/prospect/:prospectId', { params: { prospectId: '1' }, body: need });
    expect((await call('post', '/:id/return', { params: { id: '1' }, body: { note: 'Nights Madinah belum diisi' } })).status).toBe(403);
    expect((await call('post', '/:id/return', { user: users.product, params: { id: '1' }, body: { note: 'x' } })).status).toBe(422);
    const returned = await call('post', '/:id/return', { user: users.product, params: { id: '1' }, body: { note: 'Hotel Madinah penuh, pilih alternatif' } });
    expect(returned.status).toBe(200);
    expect(state.requests[0]).toMatchObject({ status: 'needs_info', returnNote: 'Hotel Madinah penuh, pilih alternatif' });
    expect(state.notified.at(-1)).toBe('returned');
    // Tidak bisa dihitung selama menunggu CS.
    expect((await call('post', '/:id/quote', { user: users.product, params: { id: '1' }, body: quote })).status).toBe(409);
    const resent = await call('patch', '/:id', { params: { id: '1' }, body: { ...need, hotelMadinah: 'Anwar Al Madinah' } });
    expect(resent.status).toBe(200);
    expect(state.requests[0]).toMatchObject({ status: 'submitted', returnNote: null });
    expect(state.notified.at(-1)).toBe('submitted');
  });

  it('DP minimal bayi wajib diisi bila ada bayi, dan disepakati memberi tahu Tim LA', async () => {
    await call('post', '/prospect/:prospectId', { params: { prospectId: '1' }, body: { ...need, paxInfant: 1 } });
    const base = { ...quote, offeredPrices: { quad: 38_000_000, infant: 10_000_000 }, floorPrices: { quad: 35_000_000, infant: 9_000_000 } };
    expect((await call('post', '/:id/quote', { user: users.product, params: { id: '1' }, body: base })).error).toContain('DP minimal bayi');
    expect((await call('post', '/:id/quote', { user: users.product, params: { id: '1' }, body: { ...base, minDpInfant: 0 } })).status).toBe(200);
    expect(state.requests[0]!.minDpInfant).toBe(0);
    await call('post', '/:id/agree', { params: { id: '1' }, body: { agreedPrice: 80_000_000 } });
    expect(state.notified.at(-1)).toBe('agreed');
  });

  it('mengubah kebutuhan yang sedang dihitung memberi tahu Tim LA; harga dari versi lama ditolak', async () => {
    await call('post', '/prospect/:prospectId', { params: { prospectId: '1' }, body: need });
    const version = state.requests[0]!.updatedAt.toISOString();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await call('patch', '/:id', { params: { id: '1' }, body: { ...need, hotelMakkah: 'Swissotel' } });
    expect(state.notified.at(-1)).toBe('updated');
    const stale = await call('post', '/:id/quote', { user: users.product, params: { id: '1' }, body: { ...quote, version } });
    expect(stale.status).toBe(409);
    expect(stale.error).toContain('Muat ulang');
    const fresh = await call('post', '/:id/quote', { user: users.product, params: { id: '1' }, body: { ...quote, version: state.requests[0]!.updatedAt.toISOString() } });
    expect(fresh.status).toBe(200);
  });

  it('invoice yang sudah terkirim harus dibatalkan secara sadar sebelum kebutuhan diubah', async () => {
    await call('post', '/prospect/:prospectId', { params: { prospectId: '1' }, body: need });
    await call('post', '/:id/quote', { user: users.product, params: { id: '1' }, body: quote });
    await call('post', '/:id/agree', { params: { id: '1' }, body: { agreedPrice: 72_000_000 } });
    Object.assign(state.prospects[0]!, { status: 'closing', invoiceSentAt: new Date(), invoiceAmount: 20_000_000, invoiceNumber: 'INV/202609/0001' });
    const blocked = await call('patch', '/:id', { params: { id: '1' }, body: { ...need, paxQuad: 3 } });
    expect(blocked.status).toBe(409);
    expect(blocked.error).toContain('INV/202609/0001');
    const ok = await call('patch', '/:id', { params: { id: '1' }, body: { ...need, paxQuad: 3, voidInvoice: true } });
    expect(ok.status).toBe(200);
    expect(state.prospects[0]).toMatchObject({ status: 'offer', invoiceNumber: null, invoiceAmount: 0, invoiceSentAt: null, dealValue: 0 });
    expect(state.logs.some((log) => log.actionType === 'invoice_voided')).toBe(true);
  });

  it('bulan keberangkatan dan budget custom mengisi Kualifikasi yang masih kosong', async () => {
    Object.assign(state.prospects[0]!, { status: 'contact', targetMonth: null, budgetRange: null });
    await call('post', '/prospect/:prospectId', { params: { prospectId: '1' }, body: need });
    // need: berangkat 2027-02-10, budget 35 juta per orang, paspor sudah ada → lengkap → Terkualifikasi.
    expect(state.prospects[0]).toMatchObject({ targetMonth: '2027-02', budgetRange: '30–35 Juta', status: 'qualified' });
  });

  it('Tim LA mengambil permintaan; anggota lain perlu konfirmasi untuk mengirim harga; harga terkirim melepas klaim', async () => {
    await call('post', '/prospect/:prospectId', { params: { prospectId: '1' }, body: need });
    expect((await call('post', '/:id/claim', { params: { id: '1' } })).status).toBe(403);
    expect((await call('post', '/:id/claim', { user: users.product, params: { id: '1' } })).status).toBe(200);
    expect(state.requests[0]!.claimedById).toBe(30);
    const blocked = await call('post', '/:id/quote', { user: users.product2, params: { id: '1' }, body: quote });
    expect(blocked.status).toBe(409);
    expect(blocked.error).toContain('Sedang dihitung');
    expect((await call('post', '/:id/release', { user: users.product2, params: { id: '1' } })).status).toBe(409);
    const forced = await call('post', '/:id/quote', { user: users.product2, params: { id: '1' }, body: { ...quote, force: true } });
    expect(forced.status).toBe(200);
    expect(state.requests[0]!.claimedById).toBeNull();
  });
});
