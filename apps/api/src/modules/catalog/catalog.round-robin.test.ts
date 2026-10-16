import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));

vi.mock('../../realtime/socket.js', () => ({ emitToBrand: vi.fn() }));
vi.mock('../../db/prisma.js', () => ({ prisma: {} }));
vi.mock('../prospects/round-robin.js', () => ({ getRoundRobinSettings: mocks.get, saveRoundRobinSettings: mocks.save }));
vi.mock('../../middleware/auth.js', async () => {
  const actual = await vi.importActual<typeof import('../../middleware/auth.js')>('../../middleware/auth.js');
  return { ...actual, authGuard: (_req: unknown, _res: unknown, next: () => void) => next() };
});

import { catalogRouter } from './catalog.routes.js';

type User = { id: number; name: string; role: string; brandId: number | null; userBrands?: { brand: { id: number } }[] };
const superadmin: User = { id: 1, name: 'Super', role: 'superadmin', brandId: null };
const admin = (brandId: number | null, extra: number[] = []): User => ({ id: 2, name: 'Admin', role: 'admin', brandId, userBrands: extra.map((id) => ({ brand: { id } })) });
const cs: User = { id: 3, name: 'CS', role: 'cs', brandId: 1 };

/** Menjalankan seluruh rantai route (requireRole + handler), bukan hanya handler terakhir. */
function call(method: 'get' | 'put', id: string, user: User, body?: Record<string, unknown>) {
  const layer = (catalogRouter as any).stack.find((l: any) => l.route?.path === '/brands/:id/round-robin' && l.route.methods[method]);
  return new Promise<any>((resolve, reject) => {
    const res: any = { json: (payload: any) => resolve(payload.data), status: () => res };
    const req = { params: { id }, body, query: {}, user };
    const handlers = layer.route.stack.map((s: any) => s.handle);
    const run = (index: number): void => {
      const handler = handlers[index];
      if (!handler) return;
      handler(req, res, (error: unknown) => (error ? reject(error) : run(index + 1)));
    };
    run(0);
  });
}

const settings = { enabled: true, total: 100, members: [{ userId: 5, name: 'Nisa', percent: 100, assignedCount: 0 }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(settings);
  mocks.save.mockResolvedValue(settings);
});

describe('Pengaturan round robin CS (route)', () => {
  it('CS dan peran lain ditolak', async () => {
    await expect(call('get', '1', cs)).rejects.toMatchObject({ status: 403 });
    await expect(call('put', '1', cs, { enabled: false, shares: [] })).rejects.toMatchObject({ status: 403 });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('Superadmin boleh untuk brand mana pun', async () => {
    await expect(call('get', '7', superadmin)).resolves.toEqual(settings);
    expect(mocks.get).toHaveBeenCalledWith(7);
  });

  it('Admin berbrand hanya untuk brand yang dipegang (utama atau penugasan)', async () => {
    await expect(call('get', '1', admin(1))).resolves.toEqual(settings);
    await expect(call('get', '4', admin(1, [4]))).resolves.toEqual(settings);
    await expect(call('get', '2', admin(1))).rejects.toMatchObject({ status: 403 });
    await expect(call('put', '2', admin(1), { enabled: false, shares: [] })).rejects.toMatchObject({ status: 403 });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('Admin tanpa brand (holding) boleh untuk semua brand', async () => {
    await expect(call('get', '9', admin(null))).resolves.toEqual(settings);
  });

  it('id brand tidak valid ditolak', async () => {
    await expect(call('get', 'abc', superadmin)).rejects.toMatchObject({ status: 400 });
    await expect(call('get', '0', superadmin)).rejects.toMatchObject({ status: 400 });
  });

  it('PUT menyimpan setelan; persen di luar 0–100 atau bukan bilangan bulat ditolak sebelum menyentuh data', async () => {
    await call('put', '1', admin(1), { enabled: true, shares: [{ userId: 5, percent: 100 }] });
    expect(mocks.save).toHaveBeenCalledWith(1, { enabled: true, shares: [{ userId: 5, percent: 100 }] });
    mocks.save.mockClear();
    await expect(call('put', '1', admin(1), { enabled: true, shares: [{ userId: 5, percent: 101 }] })).rejects.toBeTruthy();
    await expect(call('put', '1', admin(1), { enabled: true, shares: [{ userId: 5, percent: 33.5 }] })).rejects.toBeTruthy();
    await expect(call('put', '1', admin(1), { shares: [] })).rejects.toBeTruthy();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('perubahan setelan dicatat di log audit (siapa, dari apa ke apa)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    mocks.get.mockResolvedValue({ enabled: false, total: 0, members: [{ userId: 5, name: 'Nisa', percent: 0, assignedCount: 0 }] });
    await call('put', '1', admin(1), { enabled: true, shares: [{ userId: 5, percent: 100 }] });
    expect(info.mock.calls[0]![0]).toContain('[audit] brand 1 roundRobin off[-] -> on[5:100%] oleh user 2 (Admin)');
    info.mockRestore();
  });
});
