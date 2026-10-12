import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), emit: vi.fn() }));

vi.mock('../../realtime/socket.js', () => ({ emitToBrand: mocks.emit }));

vi.mock('../../db/prisma.js', () => ({
  prisma: { brand: { create: mocks.create, update: mocks.update, findUnique: mocks.findUnique } },
}));
vi.mock('../../middleware/auth.js', async () => {
  const actual = await vi.importActual<typeof import('../../middleware/auth.js')>('../../middleware/auth.js');
  return { ...actual, authGuard: (_req: unknown, _res: unknown, next: () => void) => next() };
});

import { catalogRouter } from './catalog.routes.js';

function call(method: 'post' | 'patch', path: string, body: Record<string, unknown>, params: Record<string, string> = {}) {
  const layer = (catalogRouter as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
  return new Promise<any>((resolve, reject) => {
    const res = { json: (payload: any) => resolve(payload.data), status: () => res };
    layer.route.stack.at(-1).handle({ params, body, query: {}, user: { id: 1, role: 'superadmin', brandId: null } }, res, (error: unknown) => (error ? reject(error) : resolve(undefined)));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockImplementation(async ({ data }: any) => ({ id: 9, ...data }));
  mocks.update.mockImplementation(async ({ data }: any) => ({ id: 9, ...data }));
  mocks.findUnique.mockResolvedValue({ id: 9, logoUrl: null, picLocked: false });
});

describe('Kunci PIC pada pengaturan brand', () => {
  it('membuat brand baru dengan Kunci PIC aktif menyimpan picLocked', async () => {
    await call('post', '/brands', { name: 'Brand Baru', code: 'BARU', picLocked: true });
    expect(mocks.create.mock.calls[0][0].data.picLocked).toBe(true);
  });

  it('mengubah brand menyimpan picLocked; tanpa field tidak menyentuh nilainya', async () => {
    await call('patch', '/brands/:id', { picLocked: true }, { id: '9' });
    expect(mocks.update.mock.calls[0][0].data).toEqual({ picLocked: true });
    await call('patch', '/brands/:id', { name: 'Brand Lama' }, { id: '9' });
    expect(mocks.update.mock.calls[1][0].data).not.toHaveProperty('picLocked');
  });

  it('perubahan Kunci PIC dikabarkan ke klien realtime; nilai yang sama tidak', async () => {
    await call('patch', '/brands/:id', { picLocked: true }, { id: '9' });
    expect(mocks.emit).toHaveBeenCalledWith(9, 'brand:updated', { brandId: 9, picLocked: true });
    mocks.emit.mockClear();
    await call('patch', '/brands/:id', { picLocked: false }, { id: '9' });
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});
