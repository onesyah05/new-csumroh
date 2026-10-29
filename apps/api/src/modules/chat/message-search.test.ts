import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), devicePhone: '62811000' as string | null }));

vi.mock('../../db/prisma.js', () => ({ prisma: { chatMessage: { findMany: mocks.findMany } } }));
vi.mock('./device-scope.js', () => ({ activeDevicePhone: async () => mocks.devicePhone }));

import { messageSnippet, searchConversationMessages } from './message-search.js';

const msg = (prospectId: number, timestamp: number, messageText: string, isFromMe = false) => ({
  prospectId, messageId: `m${timestamp}`, isFromMe, timestamp, messageText,
});

beforeEach(() => {
  mocks.findMany.mockReset();
  mocks.devicePhone = '62811000';
});

describe('Pencarian isi pesan', () => {
  it('mencari pesan jamaah dan PIC pada brand + device aktif, tanpa pesan terhapus', async () => {
    mocks.findMany.mockResolvedValue([]);
    await searchConversationMessages(3, ' desember ');
    const args = mocks.findMany.mock.calls[0]![0];
    expect(args.where).toMatchObject({ brandId: 3, devicePhone: '62811000', isDeleted: false, messageText: { contains: 'desember' } });
    expect(args.where).not.toHaveProperty('isFromMe');
  });

  it('satu hasil per prospek: pesan cocok terbaru dan jumlahnya, dari kedua arah', async () => {
    mocks.findMany.mockResolvedValue([
      msg(1, 300, 'Berangkat Desember ya, Pak', true),
      msg(2, 250, 'Ada paket desember?'),
      msg(1, 100, 'Saya mau desember'),
    ]);
    const result = await searchConversationMessages(1, 'desember');
    expect(result).toEqual([
      expect.objectContaining({ prospectId: 1, messageId: 'm300', isFromMe: true, count: 2 }),
      expect.objectContaining({ prospectId: 2, messageId: 'm250', isFromMe: false, count: 1 }),
    ]);
  });

  it('kata terlalu pendek atau device tidak aktif tidak menjalankan query', async () => {
    expect(await searchConversationMessages(1, ' a ')).toEqual([]);
    mocks.devicePhone = null;
    expect(await searchConversationMessages(1, 'desember')).toEqual([]);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});

describe('messageSnippet', () => {
  it('pesan pendek utuh; pesan panjang dipotong di sekitar kata cocok', () => {
    expect(messageSnippet('Mau  Desember\nya', 'desember')).toBe('Mau Desember ya');
    const long = `${'a'.repeat(200)} desember ${'b'.repeat(200)}`;
    const snippet = messageSnippet(long, 'desember');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.toLowerCase()).toContain('desember');
    expect(snippet.length).toBeLessThan(130);
  });
});
