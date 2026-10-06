import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn(), count: vi.fn() }));

vi.mock('../../db/prisma.js', () => ({
  prisma: { user: { findUnique: mocks.findUnique, update: mocks.update, count: mocks.count } },
}));
vi.mock('../../middleware/auth.js', async () => {
  const actual = await vi.importActual<typeof import('../../middleware/auth.js')>('../../middleware/auth.js');
  return { ...actual, authGuard: (_req: unknown, _res: unknown, next: () => void) => next() };
});
const revokeUserSessions = vi.hoisted(() => vi.fn());
vi.mock('../auth/sessions.js', () => ({ revokeUserSessions }));
vi.mock('../prospects/pic.js', () => ({ releaseProspectsOf: vi.fn(async () => 0) }));

import { catalogRouter } from './catalog.routes.js';

function toggle(actor: { id: number; role: string; brandId: number | null }, id: number) {
  const layer = (catalogRouter as any).stack.find((l: any) => l.route?.path === '/users/:id/toggle' && l.route.methods.patch);
  return new Promise<any>((resolve, reject) => {
    const res = { json: (body: any) => resolve(body.data), status: () => res };
    layer.route.stack.at(-1).handle({ params: { id: String(id) }, body: {}, query: {}, user: actor }, res, (error: unknown) => (error ? reject(error) : resolve(undefined)));
  });
}

const superadmin = { id: 1, role: 'superadmin', brandId: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockImplementation(async ({ data }: any) => ({ id: 9, ...data }));
});

describe('Mencegah terkunci dari sistem', () => {
  it('akun sendiri tidak bisa dinonaktifkan', async () => {
    mocks.findUnique.mockResolvedValue({ id: 1, role: 'superadmin', isActive: true, brandId: null });
    await expect(toggle(superadmin, 1)).rejects.toMatchObject({ status: 400 });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('Superadmin aktif terakhir tidak bisa dinonaktifkan; bila ada Superadmin lain boleh', async () => {
    mocks.findUnique.mockResolvedValue({ id: 2, role: 'superadmin', isActive: true, brandId: null });
    mocks.count.mockResolvedValueOnce(0);
    await expect(toggle(superadmin, 2)).rejects.toMatchObject({ status: 409 });
    mocks.count.mockResolvedValueOnce(1);
    await toggle(superadmin, 2);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('mengaktifkan kembali selalu boleh', async () => {
    mocks.findUnique.mockResolvedValue({ id: 2, role: 'superadmin', isActive: false, brandId: null });
    await toggle(superadmin, 2);
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.update.mock.calls[0][0].data).toEqual({ isActive: true });
  });
});

describe('Edit akun Superadmin', () => {
  it('akses brand dari form diabaikan: Superadmin tetap mengakses semua brand', async () => {
    mocks.findUnique.mockResolvedValue({ id: 1, role: 'superadmin', isActive: true, brandId: null, email: 'superadmin@azhan.id', userBrands: [] });
    mocks.update.mockImplementation(async ({ data }: any) => ({ id: 1, role: 'superadmin', ...data }));
    const layer = (catalogRouter as any).stack.find((l: any) => l.route?.path === '/users/:id' && l.route.methods.patch);
    await new Promise<any>((resolve, reject) => {
      const res = { json: (body: any) => resolve(body.data), status: () => res };
      layer.route.stack.at(-1).handle({ params: { id: '1' }, body: { name: 'Super Admin', brandIds: [] }, query: {}, user: superadmin }, res, (e: unknown) => (e ? reject(e) : resolve(undefined)));
    });
    const data = mocks.update.mock.calls[0][0].data;
    expect(data.name).toBe('Super Admin');
    expect(data).not.toHaveProperty('brandId');
  });
});

describe('Ganti kata sandi', () => {
  it('kata sandi sendiri diganti: semua sesi akun itu diputus (akun dicurigai bocor)', async () => {
    mocks.findUnique.mockResolvedValue({ id: 1, role: 'superadmin', isActive: true, brandId: null, email: 'superadmin@azhan.id', userBrands: [] });
    mocks.update.mockImplementation(async ({ data }: any) => ({ id: 1, role: 'superadmin', ...data }));
    const layer = (catalogRouter as any).stack.find((l: any) => l.route?.path === '/users/:id' && l.route.methods.patch);
    await new Promise<any>((resolve, reject) => {
      const res = { json: (body: any) => resolve(body.data), status: () => res };
      layer.route.stack.at(-1).handle({ params: { id: '1' }, body: { name: 'Super Admin', password: 'kata-sandi-baru-123' }, query: {}, user: superadmin }, res, (e: unknown) => (e ? reject(e) : resolve(undefined)));
    });
    expect(revokeUserSessions).toHaveBeenCalledWith(1);
  });
});

describe('Edit data staf', () => {
  it('akses brand tidak berubah: sesi CS tidak diputus saat mengganti nama', async () => {
    mocks.findUnique.mockResolvedValue({ id: 5, role: 'cs', isActive: true, brandId: 2, email: 'cs@azhan.id', name: 'CS Lama', userBrands: [{ brandId: 2 }, { brandId: 3 }] });
    mocks.update.mockImplementation(async ({ data }: any) => ({ id: 5, role: 'cs', ...data }));
    const layer = (catalogRouter as any).stack.find((l: any) => l.route?.path === '/users/:id' && l.route.methods.patch);
    await new Promise<any>((resolve, reject) => {
      const res = { json: (body: any) => resolve(body.data), status: () => res };
      layer.route.stack.at(-1).handle({ params: { id: '5' }, body: { name: 'CS Baru', brandIds: [2, 3] }, query: {}, user: superadmin }, res, (e: unknown) => (e ? reject(e) : resolve(undefined)));
    });
    expect(mocks.update.mock.calls[0][0].data).toEqual({ name: 'CS Baru' });
    expect(revokeUserSessions).not.toHaveBeenCalled();
  });
});
