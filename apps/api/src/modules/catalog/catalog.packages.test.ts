import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() }));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    package: { findMany: mocks.findMany, findUnique: mocks.findUnique, update: mocks.update, create: mocks.create, count: async () => 0 },
    chatMessage: { count: async () => 0 },
  },
}));
vi.mock('../../middleware/auth.js', async () => {
  const actual = await vi.importActual<typeof import('../../middleware/auth.js')>('../../middleware/auth.js');
  return { ...actual, authGuard: (_req: unknown, _res: unknown, next: () => void) => next() };
});

import { catalogRouter } from './catalog.routes.js';

type User = { id: number; role: string; brandId: number | null; userBrands?: { brand: { id: number } }[] };
function call(path: '/packages' | '/packages/:id', user: User, query: Record<string, string> = {}, params: Record<string, string> = {}) {
  const layer = (catalogRouter as any).stack.find((l: any) => l.route?.path === path && l.route.methods.get);
  return new Promise<any>((resolve, reject) => {
    const res = { json: (body: any) => resolve(body.data), status: () => res };
    layer.route.stack.at(-1).handle({ query, params, user }, res, (error: unknown) => (error ? reject(error) : resolve(undefined)));
  });
}

const csMulti: User = { id: 7, role: 'cs', brandId: 1, userBrands: [{ brand: { id: 1 } }, { brand: { id: 6 } }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
});

describe('Paket per brand', () => {
  it('CS multi-brand mendapat paket brand yang sedang dilayani, bukan brand utamanya', async () => {
    await call('/packages', csMulti, { brandId: '6' });
    expect(mocks.findMany.mock.calls[0][0].where.brandId).toBe(6);
  });

  it('CS tidak bisa meminta paket brand yang tidak ia pegang; tanpa filter melihat semua brand tugasnya', async () => {
    await expect(call('/packages', csMulti, { brandId: '9' })).rejects.toMatchObject({ status: 403 });
    await call('/packages', csMulti);
    expect(mocks.findMany.mock.calls[0][0].where.brandId).toEqual({ in: [1, 6] });
  });

  it('Admin tanpa brand (holding) memakai brand yang diminta', async () => {
    await call('/packages', { id: 2, role: 'admin', brandId: null }, { brandId: '6' });
    expect(mocks.findMany.mock.calls[0][0].where.brandId).toBe(6);
  });

  it('Admin yang punya brand tidak boleh meminta brand lain', async () => {
    await expect(call('/packages', { id: 2, role: 'admin', brandId: 1 }, { brandId: '6' })).rejects.toMatchObject({ status: 403 });
  });

  it('"Semua brand": Admin bertugas = brand tugasnya, Superadmin = semua; tanpa filter Admin tetap brand utamanya', async () => {
    const admin = { id: 2, role: 'admin', brandId: 1, userBrands: [{ brand: { id: 6 } }] };
    await call('/packages', admin, { brandId: 'all' });
    expect(mocks.findMany.mock.calls[0][0].where.brandId).toEqual({ in: [1, 6] });
    await call('/packages', { id: 1, role: 'superadmin', brandId: null }, { brandId: 'all' });
    expect(mocks.findMany.mock.calls[1][0].where.brandId).toBeUndefined();
    mocks.findMany.mockClear();
    await call('/packages', admin);
    expect(mocks.findMany.mock.calls[0][0].where.brandId).toBe(1);
    // CS yang meminta "all" tetap dibatasi ke brand tugasnya.
    await call('/packages', csMulti, { brandId: 'all' });
    expect(mocks.findMany.mock.calls[1][0].where.brandId).toEqual({ in: [1, 6] });
  });

  it('CS dengan satu brand: brand itu saja', async () => {
    await call('/packages', { id: 8, role: 'cs', brandId: null, userBrands: [{ brand: { id: 6 } }] });
    expect(mocks.findMany.mock.calls[0][0].where.brandId).toBe(6);
  });

  it('filter "Habis" digabung AND dengan pencarian', async () => {
    await call('/packages', csMulti, { q: 'Syawal', quota: 'sold_out' });
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where.OR[0]).toEqual({ name: { contains: 'Syawal' } });
    expect(where.AND).toEqual([{ OR: [{ quotaRemaining: 0 }, { quotaRemaining: null }] }]);
  });

  it('detail paket brand kedua bisa dibuka CS yang memegangnya; brand lain ditolak', async () => {
    mocks.findUnique.mockResolvedValueOnce({ id: 3, brandId: 6 });
    expect(await call('/packages/:id', csMulti, {}, { id: '3' })).toMatchObject({ id: 3 });
    mocks.findUnique.mockResolvedValueOnce({ id: 4, brandId: 9 });
    await expect(call('/packages/:id', csMulti, {}, { id: '4' })).rejects.toMatchObject({ status: 403 });
  });
});

function write(method: 'post' | 'patch' | 'delete', path: string, user: User, body: Record<string, unknown> = {}, params: Record<string, string> = {}) {
  const layer = (catalogRouter as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
  return new Promise<any>((resolve, reject) => {
    const res = { json: (out: any) => resolve(out.data), status: () => res };
    layer.route.stack.at(-1).handle({ body, params, query: {}, user }, res, (error: unknown) => (error ? reject(error) : resolve(undefined)));
  });
}

describe('Admin multi-brand mengelola paket', () => {
  const adminMulti: User = { id: 2, role: 'admin', brandId: 1, userBrands: [{ brand: { id: 6 } }] };
  beforeEach(() => {
    mocks.update.mockImplementation(async ({ data }: any) => ({ id: 3, ...data }));
    mocks.create.mockImplementation(async ({ data }: any) => ({ id: 10, ...data }));
  });

  it('boleh mengedit dan menonaktifkan paket brand penugasannya, bukan hanya brand utama', async () => {
    mocks.findUnique.mockResolvedValue({ id: 3, brandId: 6, isActive: true });
    await write('patch', '/packages/:id', adminMulti, { name: 'Umroh Syawal' }, { id: '3' });
    await write('patch', '/packages/:id/toggle', adminMulti, {}, { id: '3' });
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it('paket brand yang tidak ditugaskan ditolak; memindahkan paket ke brand itu juga ditolak', async () => {
    mocks.findUnique.mockResolvedValue({ id: 4, brandId: 9, isActive: true });
    await expect(write('patch', '/packages/:id', adminMulti, { name: 'X' }, { id: '4' })).rejects.toMatchObject({ status: 403 });
    mocks.findUnique.mockResolvedValue({ id: 3, brandId: 6, isActive: true });
    await expect(write('patch', '/packages/:id', adminMulti, { brandId: 9 }, { id: '3' })).rejects.toMatchObject({ status: 403 });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('membuat paket untuk brand penugasan; brand lain ditolak', async () => {
    const body = { name: 'Umroh Ramadhan', price: 'Rp 30.000.000', dp: 'Rp 5.000.000' };
    await write('post', '/packages', adminMulti, { ...body, brandId: 6 });
    expect(mocks.create.mock.calls[0][0].data.brandId).toBe(6);
    await expect(write('post', '/packages', adminMulti, { ...body, brandId: 9 })).rejects.toMatchObject({ status: 403 });
  });
});

function patch(user: User, id: number, body: Record<string, unknown>) {
  const layer = (catalogRouter as any).stack.find((l: any) => l.route?.path === '/packages/:id' && l.route.methods.patch);
  return new Promise<any>((resolve, reject) => {
    const res = { json: (out: any) => resolve(out.data), status: () => res };
    const handlers = layer.route.stack.map((s: any) => s.handle);
    const req = { params: { id: String(id) }, body, query: {}, user };
    const run = (i: number) => handlers[i](req, res, (error?: unknown) => (error ? reject(error) : run(i + 1)));
    run(0);
  });
}

describe('Edit paket', () => {
  beforeEach(() => {
    mocks.update.mockImplementation(async ({ data }: any) => ({ id: 3, ...data }));
  });

  it('Admin multi-brand bisa memindahkan paket ke brand tugasnya (tidak diabaikan diam-diam)', async () => {
    mocks.findUnique.mockResolvedValue({ id: 3, brandId: 1, flyerImage: null, priceQuad: 'Rp 30.000.000' });
    const admin = { id: 2, role: 'admin', brandId: 1, userBrands: [{ brand: { id: 6 } }] };
    await patch(admin, 3, { brandId: 6 });
    expect(mocks.update.mock.calls[0][0].data.brandId).toBe(6);
  });

  it('tanggal keberangkatan dikosongkan: teks tanggal lama ikut dihapus', async () => {
    mocks.findUnique.mockResolvedValue({ id: 3, brandId: 1, flyerImage: null, priceQuad: 'Rp 30.000.000', departureInfo: '10 November 2026' });
    await patch({ id: 1, role: 'superadmin', brandId: null }, 3, { departureDate: null });
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ departureDate: null, departureInfo: null });
  });
});
