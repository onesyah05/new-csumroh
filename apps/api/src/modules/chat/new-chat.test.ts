import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeDevicePhone: vi.fn(),
  prospectFindFirst: vi.fn(),
  prospectCreate: vi.fn(),
  prospectDelete: vi.fn(),
  logCreate: vi.fn(),
  logDeleteMany: vi.fn(),
  sendText: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('../../db/prisma.js', () => {
  const prisma: any = {
    prospect: { findFirst: mocks.prospectFindFirst, create: mocks.prospectCreate, delete: mocks.prospectDelete },
    prospectLog: { create: mocks.logCreate, deleteMany: mocks.logDeleteMany },
    $transaction: async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)),
  };
  return { prisma };
});
vi.mock('./device-scope.js', () => ({ activeDevicePhone: mocks.activeDevicePhone }));
vi.mock('./outbound.js', async () => {
  const actual = await vi.importActual<typeof import('./outbound.js')>('./outbound.js');
  return { ...actual, sendTextToProspect: mocks.sendText, gatewayFailure: async (_b: number, _r: unknown, message: string) => Object.assign(new Error(message), { status: 502 }) };
});

import { startNewChat } from './new-chat.js';

const cs = { id: 7, name: 'Nisa', role: 'cs', brandId: 1 } as any;
const admin = { id: 1, name: 'Admin', role: 'admin', brandId: 1 } as any;
const base = { phone: '0812-3456-7890', source: 'instagram' as const, text: 'Assalamualaikum, kami dari Hana Tours.' };

const gateway = (exists: boolean) => mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: { exists } }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.activeDevicePhone.mockResolvedValue('628222');
  mocks.prospectFindFirst.mockResolvedValue(null);
  mocks.prospectCreate.mockImplementation(async ({ data }: any) => ({ id: 21, ...data }));
  mocks.sendText.mockResolvedValue({ id: 1 });
  gateway(true);
});

describe('Chat baru dari nomor sosmed', () => {
  it('pembuat menjadi PIC, sumber sosmed tersimpan, prospek tanpa kualifikasi tetap new', async () => {
    const result = await startNewChat(cs, 1, base);
    const data = mocks.prospectCreate.mock.calls[0]![0].data;
    expect(data).toMatchObject({ brandId: 1, userId: 7, phone: '6281234567890', remoteJid: '6281234567890@s.whatsapp.net', devicePhone: '628222', leadSource: 'sosmed_instagram', name: '+6281234567890' });
    expect(data).not.toHaveProperty('status');
    expect(mocks.sendText).toHaveBeenCalledWith({ user: cs, brandId: 1, prospectId: 21, text: base.text });
    expect(result).toMatchObject({ prospectId: 21, created: true });
  });

  it('kualifikasi lengkap langsung Terkualifikasi', async () => {
    await startNewChat(cs, 1, { ...base, targetMonth: '2027-02', budgetRange: '30–35 Juta', paxDouble: 2 });
    expect(mocks.prospectCreate.mock.calls[0]![0].data).toMatchObject({ status: 'qualified', roomPreference: 'Double', budgetRange: '30–35 Juta' });
    expect(mocks.prospectCreate.mock.calls[0]![0].data.qualifiedAt).toBeInstanceOf(Date);
  });

  it('kualifikasi sebagian tidak menaikkan status', async () => {
    await startNewChat(cs, 1, { ...base, budgetRange: '30–35 Juta' });
    const data = mocks.prospectCreate.mock.calls[0]![0].data;
    expect(data).toMatchObject({ budgetRange: '30–35 Juta' });
    expect(data).not.toHaveProperty('status');
  });

  it('bulan atau budget di luar daftar ditolak sebelum apa pun dibuat', async () => {
    await expect(startNewChat(cs, 1, { ...base, budgetRange: 'murah' })).rejects.toMatchObject({ status: 422 });
    await expect(startNewChat(cs, 1, { ...base, targetMonth: 'bulan depan' })).rejects.toMatchObject({ status: 422 });
    expect(mocks.prospectCreate).not.toHaveBeenCalled();
  });

  it('nomor tidak valid ditolak', async () => {
    await expect(startNewChat(cs, 1, { ...base, phone: '12345' })).rejects.toMatchObject({ status: 422 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('nomor tidak terdaftar di WhatsApp: tidak ada prospek dan tidak ada pesan', async () => {
    gateway(false);
    await expect(startNewChat(cs, 1, base)).rejects.toMatchObject({ status: 422 });
    expect(mocks.prospectCreate).not.toHaveBeenCalled();
    expect(mocks.sendText).not.toHaveBeenCalled();
  });

  it('sesi WhatsApp brand mati: ditolak tanpa menghubungi gateway', async () => {
    mocks.activeDevicePhone.mockResolvedValue(null);
    await expect(startNewChat(cs, 1, base)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('belum terhubung') });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.prospectCreate).not.toHaveBeenCalled();
  });

  it('kirim gagal: prospek yang baru dibuat dibatalkan', async () => {
    mocks.sendText.mockRejectedValue(Object.assign(new Error('WhatsApp menolak'), { status: 502 }));
    await expect(startNewChat(cs, 1, base)).rejects.toMatchObject({ status: 502 });
    expect(mocks.prospectDelete).toHaveBeenCalledWith({ where: { id: 21 } });
    expect(mocks.logDeleteMany).toHaveBeenCalledWith({ where: { prospectId: 21 } });
  });

  it('nomor sudah dipegang CS lain: 409 dengan nama PIC, tidak ada kiriman', async () => {
    mocks.prospectFindFirst.mockResolvedValue({ id: 5, name: 'Bu Aisyah', userId: 9, user: { name: 'Rani' } });
    await expect(startNewChat(cs, 1, base)).rejects.toMatchObject({
      status: 409,
      details: { code: 'already_handled', prospectId: 5, picName: 'Rani' },
    });
    expect(mocks.sendText).not.toHaveBeenCalled();
    expect(mocks.prospectCreate).not.toHaveBeenCalled();
  });

  it('nomor sudah ada dan milik sendiri atau tanpa PIC: kirim ke percakapan lama tanpa duplikat', async () => {
    mocks.prospectFindFirst.mockResolvedValue({ id: 5, name: 'Bu Aisyah', userId: null, user: null });
    const result = await startNewChat(cs, 1, base);
    expect(mocks.sendText).toHaveBeenCalledWith({ user: cs, brandId: 1, prospectId: 5, text: base.text });
    expect(mocks.prospectCreate).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ prospectId: 5, created: false });
  });

  it('admin boleh mengirim ke prospek yang dipegang CS', async () => {
    mocks.prospectFindFirst.mockResolvedValue({ id: 5, name: 'Bu Aisyah', userId: 9, user: { name: 'Rani' } });
    await expect(startNewChat(admin, 1, base)).resolves.toMatchObject({ prospectId: 5, created: false });
  });

  it('pencarian duplikat dibatasi device aktif dan mencakup format nomor 0xxx / +62', async () => {
    await startNewChat(cs, 1, base);
    const where = mocks.prospectFindFirst.mock.calls[0]![0].where;
    expect(where).toMatchObject({ brandId: 1, devicePhone: '628222' });
    expect(where.OR[0].phone.in).toEqual(expect.arrayContaining(['6281234567890', '+6281234567890', '081234567890']));
  });
});
