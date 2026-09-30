import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('../../db/prisma.js', () => ({ prisma: { whatsappSession: { update: mocks.update } } }));

import { resetGatewayProbes, syncSessionWithGateway } from './gateway-probe.js';

const connected = { brandId: 1, status: 'connected', phoneNumber: '62811', qrCode: null, disconnectReason: null } as any;

beforeEach(() => {
  resetGatewayProbes();
  mocks.update.mockReset();
  mocks.update.mockImplementation(async ({ data }: any) => ({ ...connected, ...data }));
});
afterEach(() => vi.unstubAllGlobals());

describe('Status sesi dari gateway', () => {
  it('satu probe gagal belum dianggap putus; dua kali berturut-turut = putus dengan alasan gateway', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    expect(await syncSessionWithGateway(1, connected)).toBe(connected);
    expect(mocks.update).not.toHaveBeenCalled();
    const second = await syncSessionWithGateway(1, connected);
    expect(second).toMatchObject({ status: 'disconnected', disconnectReason: 'gateway_unreachable' });
  });

  it('probe berhasil di antaranya mengulang hitungan', async () => {
    const fail = vi.fn(async () => { throw new Error('timeout'); });
    const ok = vi.fn(async () => ({ ok: true, json: async () => ({ data: { status: 'connected' } }) }));
    vi.stubGlobal('fetch', fail);
    await syncSessionWithGateway(1, connected);
    vi.stubGlobal('fetch', ok);
    await syncSessionWithGateway(1, connected);
    vi.stubGlobal('fetch', fail);
    await syncSessionWithGateway(1, connected);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('tersambung lagi menghapus alasan putus', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: { status: 'connected', phoneNumber: '62811:3@s.whatsapp.net' } }) })));
    const result = await syncSessionWithGateway(1, { ...connected, status: 'disconnected', disconnectReason: 'connection_lost' });
    expect(result).toMatchObject({ status: 'connected', disconnectReason: null, phoneNumber: '62811' });
  });
});
