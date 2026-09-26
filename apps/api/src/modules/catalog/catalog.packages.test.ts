import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), findUnique: vi.fn() }));

vi.mock('../../db/prisma.js', () => ({
  prisma: { package: { findMany: mocks.findMany, findUnique: mocks.findUnique } },
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

  it('CS tidak bisa meminta paket brand yang tidak ia pegang; tanpa brandId tetap brand utama', async () => {
    await expect(call('/packages', csMulti, { brandId: '9' })).rejects.toMatchObject({ status: 403 });
    await call('/packages', csMulti);
    expect(mocks.findMany.mock.calls[0][0].where.brandId).toBe(1);
  });

  it('Admin lintas brand memakai brand yang diminta', async () => {
    await call('/packages', { id: 2, role: 'admin', brandId: 1 }, { brandId: '6' });
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
