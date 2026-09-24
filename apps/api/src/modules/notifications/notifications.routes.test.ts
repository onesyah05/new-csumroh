import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn(async () => 0), updateMany: vi.fn(), emitToUser: vi.fn(), prefFindMany: vi.fn(async () => [] as unknown[]), upsert: vi.fn(async () => ({})) }));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    notification: { findMany: mocks.findMany, count: mocks.count, updateMany: mocks.updateMany },
    notificationPreference: { findMany: mocks.prefFindMany, upsert: mocks.upsert },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));
vi.mock('../../middleware/auth.js', () => ({ authGuard: (_req: any, _res: any, next: any) => next() }));
vi.mock('../../realtime/socket.js', () => ({ emitToUser: mocks.emitToUser }));

import { notificationsRouter } from './notifications.routes.js';

function invoke(method: string, route: string, opts: { id?: string; query?: any; body?: any; role?: string } = {}) {
  const layer = (notificationsRouter as any).stack.find((l: any) => l.route?.path === route && l.route.methods[method]);
  return new Promise<any>((resolve) => {
    let status = 200;
    const res = { status: (s: number) => { status = s; return res; }, json: (data: any) => resolve({ status, ...data }) };
    const req = { params: { id: opts.id ?? '1' }, query: opts.query ?? {}, body: opts.body ?? {}, user: { id: 5, role: opts.role ?? 'cs' } };
    layer.route.stack.at(-1).handle(req, res, (error: any) => resolve({ status: error.status ?? 500, error: error.message }));
  });
}

beforeEach(() => vi.clearAllMocks());

describe('notifications API', () => {
  it('daftar hanya milik user yang login, dengan cursor halaman berikutnya', async () => {
    mocks.findMany.mockResolvedValue([3, 2, 1].map((id) => ({ id, type: 't', priority: 'info', title: 'x', body: null, link: null, count: 1, createdAt: new Date(), readAt: null, resolvedAt: null, updatedAt: new Date() })));
    const result = await invoke('get', '/', { query: { filter: 'action', limit: '2' } });
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: 5, readAt: null, resolvedAt: null, priority: { in: ['action', 'urgent'] } });
    expect(result.data.items).toHaveLength(2);
    expect(result.data.nextCursor).toBe(2);
  });

  it('tandai dibaca: notifikasi user lain = 404, baris ringkasan ditutup', async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await invoke('post', '/:id/read', { id: '9' })).status).toBe(404);
    expect(mocks.updateMany.mock.calls[0][0].where).toEqual({ id: 9, userId: 5 });

    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    const ok = await invoke('post', '/:id/read', { id: '9' });
    expect(ok.status).toBe(200);
    expect(mocks.updateMany.mock.calls[1][0].data.activeKey).toBeNull();
    expect(mocks.emitToUser).toHaveBeenCalledWith(5, 'notification:read', { ids: [9] });
  });

  it('hitungan belum dibaca tidak menghitung notifikasi yang sudah selesai', async () => {
    await invoke('get', '/unread-count');
    expect(mocks.count.mock.calls[0][0].where).toEqual({ userId: 5, readAt: null, resolvedAt: null });
  });
});

describe('preferensi notifikasi', () => {
  it('hanya tipe yang relevan untuk role; default dan pilihan tersimpan digabung', async () => {
    mocks.prefFindMany.mockResolvedValueOnce([{ type: 'message.inbound', toast: true, sound: true }]);
    const result = await invoke('get', '/preferences');
    const types = result.data.map((p: any) => p.type);
    expect(types).toContain('lead.assigned');
    expect(types).not.toContain('wa.disconnected');
    expect(result.data.find((p: any) => p.type === 'message.inbound')).toMatchObject({ toast: true, sound: true, locked: false });
    expect(result.data.find((p: any) => p.type === 'pic.taken_over')).toMatchObject({ toast: true, locked: true });
  });

  it('menyimpan pilihan; tipe milik role lain ditolak; mendesak tidak bisa dimatikan', async () => {
    expect((await invoke('put', '/preferences', { body: { items: [{ type: 'wa.disconnected', toast: false, sound: false }] } })).status).toBe(422);
    await invoke('put', '/preferences', { body: { items: [{ type: 'pic.taken_over', toast: false, sound: true }, { type: 'lead.assigned', toast: false, sound: false }] } });
    const upserts = mocks.upsert.mock.calls.map(([arg]: any) => [arg.where.userId_type.type, arg.update]);
    expect(upserts).toEqual([['pic.taken_over', { toast: true, sound: true }], ['lead.assigned', { toast: false, sound: false }]]);
  });
});
