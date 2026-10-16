import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), create: vi.fn(), update: vi.fn() }));
vi.mock('../../db/prisma.js', () => ({ prisma: { prospectLog: { findFirst: mocks.findFirst, create: mocks.create, update: mocks.update } } }));

import { recordInboundEditLog } from './edit-log.js';

const edit = (previousText: string, nextText: string, fromMe = false) => ({ prospectId: 9, fromMe, previousText, nextText });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue(null);
});

describe('Log edit dari WhatsApp', () => {
  it('edit pertama membuat satu baris log berisi sebelum dan sesudah', async () => {
    expect(await recordInboundEditLog(edit('jadi 2 orang', 'jadi 3 orang'))).toBe('created');
    expect(mocks.create.mock.calls[0]![0].data).toEqual({
      prospectId: 9, userId: null, actionType: 'message_edited', title: 'Pesan diedit oleh jamaah', description: 'Sebelum: jadi 2 orang\nSesudah: jadi 3 orang',
    });
  });

  it('pesan milik kita yang diedit dari HP brand memakai judul berbeda', async () => {
    await recordInboundEditLog(edit('a', 'b', true));
    expect(mocks.create.mock.calls[0]![0].data.title).toBe('Pesan diedit dari HP brand');
  });

  it('edit beruntun pada pesan yang sama digabung: sebelum tetap versi pertama, sesudah versi terbaru', async () => {
    mocks.findFirst.mockResolvedValue({ id: 55, description: 'Sebelum: jadi 2 orang\nSesudah: jadi 3 orang' });
    expect(await recordInboundEditLog(edit('jadi 3 orang', 'jadi 4 orang'))).toBe('merged');
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 55 }, data: { description: 'Sebelum: jadi 2 orang\nSesudah: jadi 4 orang' } });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('edit pada pesan LAIN (teks sebelumnya tidak cocok) tetap membuat baris baru', async () => {
    mocks.findFirst.mockResolvedValue({ id: 55, description: 'Sebelum: jadi 2 orang\nSesudah: jadi 3 orang' });
    expect(await recordInboundEditLog(edit('berangkat Maret', 'berangkat April'))).toBe('created');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('hanya mencari log dalam 5 menit terakhir milik prospek itu dengan judul yang sama', async () => {
    const now = Date.parse('2026-10-16T05:00:00.000Z');
    await recordInboundEditLog(edit('a', 'b'), now);
    const where = mocks.findFirst.mock.calls[0]![0].where;
    expect(where).toMatchObject({ prospectId: 9, actionType: 'message_edited', userId: null, title: 'Pesan diedit oleh jamaah' });
    expect(where.createdAt.gte.toISOString()).toBe('2026-10-16T04:55:00.000Z');
  });

  it('teks panjang dipotong 300 karakter; deskripsi bukan bentuk kita tidak digabung', async () => {
    mocks.findFirst.mockResolvedValue({ id: 1, description: 'catatan manual' });
    await recordInboundEditLog(edit('x'.repeat(500), 'y'.repeat(500)));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create.mock.calls[0]![0].data.description).toBe(`Sebelum: ${'x'.repeat(300)}\nSesudah: ${'y'.repeat(300)}`);
  });
});
