import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  dedupe: vi.fn(),
  preference: vi.fn(async () => null as null | { toast: boolean; sound: boolean }),
  emitToUser: vi.fn(),
}));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    notification: { create: mocks.create, upsert: mocks.upsert, update: mocks.update, findMany: mocks.findMany, updateMany: mocks.updateMany },
    notificationDedupe: { create: mocks.dedupe },
    notificationPreference: { findUnique: mocks.preference },
  },
}));
vi.mock('../../realtime/socket.js', () => ({ emitToUser: mocks.emitToUser }));

import { notify, resolveNotifications, safeLink } from './notify.service.js';

const row = (id: number, extra: Record<string, unknown> = {}) => ({
  id, type: 'payment.proof_new', priority: 'action', title: 'T', body: null, link: '/verifikasi', count: 1, createdAt: new Date(), ...extra,
});
const unique = () => new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockImplementation(async ({ data }: any) => row(data.userId * 10));
  mocks.upsert.mockImplementation(async ({ create }: any) => row(create.userId * 10, { count: 2 }));
});

describe('notify', () => {
  it('menyimpan per penerima, tanpa pelaku, lalu mengirim ke room pribadi', async () => {
    const count = await notify({ type: 'payment.proof_new', priority: 'action', userIds: [3, 4, 3, 7], actorId: 7, title: 'Bukti baru', link: '/verifikasi' });
    expect(count).toBe(2);
    expect(mocks.create.mock.calls.map(([arg]: any) => arg.data.userId)).toEqual([3, 4]);
    expect(mocks.emitToUser).toHaveBeenCalledWith(3, 'notification:new', expect.objectContaining({ id: 30, link: '/verifikasi' }));
  });

  it('activeKey meringkas: upsert menambah hitungan pada baris aktif', async () => {
    await notify({ type: 'message.inbound', priority: 'info', userIds: [3], title: 'Pesan', activeKey: 'message.inbound:p1' });
    const arg = mocks.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ userId_activeKey: { userId: 3, activeKey: 'message.inbound:p1' } });
    expect(arg.update.count).toEqual({ increment: 1 });
  });

  it('balapan membuat baris aktif yang sama: yang kalah menambah hitungan', async () => {
    mocks.upsert.mockRejectedValueOnce(unique());
    mocks.update.mockResolvedValueOnce(row(30, { count: 3 }));
    expect(await notify({ type: 'message.inbound', priority: 'info', userIds: [3], title: 'Pesan', activeKey: 'k' })).toBe(1);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('dedupeKey: kiriman kedua dengan kunci sama tidak menghasilkan notifikasi', async () => {
    mocks.dedupe.mockResolvedValueOnce({}).mockRejectedValueOnce(unique());
    const input = { type: 'lead.assigned' as const, priority: 'action' as const, userIds: [3], title: 'Lead', dedupeKey: 'x' };
    expect(await notify(input)).toBe(1);
    expect(await notify(input)).toBe(0);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('tidak pernah melempar: kegagalan DB hanya dicatat', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.create.mockRejectedValueOnce(new Error('db down'));
    await expect(notify({ type: 'lead.assigned', priority: 'action', userIds: [3], title: 'Lead' })).resolves.toBe(0);
    error.mockRestore();
  });

  it('tautan hanya path internal', () => {
    expect(safeLink('/inbox?prospectId=1')).toBe('/inbox?prospectId=1');
    expect(safeLink('https://evil.test')).toBeNull();
    expect(safeLink('//evil.test')).toBeNull();
    expect(safeLink('javascript:alert(1)')).toBeNull();
  });
});

describe('resolveNotifications', () => {
  it('menutup notifikasi kondisi dan memberi tahu tiap pemiliknya', async () => {
    mocks.findMany.mockResolvedValue([{ id: 1, userId: 3 }, { id: 2, userId: 4 }]);
    expect(await resolveNotifications({ entity: { type: 'prospect', id: 9 }, types: ['message.inbound'] })).toBe(2);
    const data = mocks.updateMany.mock.calls[0][0].data;
    expect(data.activeKey).toBeNull();
    expect(data.resolvedAt).toBeInstanceOf(Date);
    expect(mocks.emitToUser).toHaveBeenCalledWith(3, 'notification:updated', { ids: [1], resolved: true });
  });
});

describe('preferensi pada event realtime', () => {
  it('info tanpa toast secara default; pilihan user dihormati; mendesak selalu toast', async () => {
    await notify({ type: 'message.inbound', priority: 'info', userIds: [3], title: 'Pesan' });
    expect(mocks.emitToUser.mock.calls.at(-1)![2]).toMatchObject({ toast: false, sound: false });

    mocks.preference.mockResolvedValueOnce({ toast: true, sound: true });
    await notify({ type: 'message.inbound', priority: 'info', userIds: [3], title: 'Pesan' });
    expect(mocks.emitToUser.mock.calls.at(-1)![2]).toMatchObject({ toast: true, sound: true });

    mocks.preference.mockResolvedValueOnce({ toast: false, sound: false });
    await notify({ type: 'pic.taken_over', priority: 'urgent', userIds: [3], title: 'Diambil alih' });
    expect(mocks.emitToUser.mock.calls.at(-1)![2]).toMatchObject({ toast: true });
  });
});
