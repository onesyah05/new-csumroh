import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ brand: vi.fn() }));
vi.mock('../../db/prisma.js', () => ({ prisma: { brand: { findUnique: mocks.brand } } }));
vi.mock('../../middleware/auth.js', () => ({
  authGuard: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  scopedBrandId: (_req: any, requested?: number) => requested ?? 1,
}));
vi.mock('./meta-token.js', () => ({ decryptMetaToken: () => 'TOKEN', encryptMetaToken: (v: string) => v, maskMetaToken: () => '' }));

import { capiRouter } from './capi.routes.js';

function ownerDataset() {
  const layer = (capiRouter as any).stack.find((l: any) => l.route?.path === '/page-dataset');
  return new Promise<any>((resolve, reject) => {
    const res = { json: (body: any) => resolve(body.data), status: () => res };
    layer.route.stack.at(-1).handle({ body: { brandId: 1 }, user: { id: 1, role: 'admin' } }, res, reject);
  });
}

const reply = (status: number, body: string) => ({ status, text: async () => body });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brand.mockResolvedValue({ facebookPageId: '101', metaWabaId: '170', metaAccessToken: 'enc', metaPixelId: '640' });
});

describe('Dataset milik aset pengirim pesan (CTWA)', () => {
  it('mengutamakan dataset milik WhatsApp Business Account, tanpa menyimpan apa pun', async () => {
    const fetchMock = vi.fn(async () => reply(200, '{"id":"999"}'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(ownerDataset()).resolves.toEqual({ datasetId: '999', owner: 'WhatsApp Business Account', currentDatasetId: '640', same: false });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/\/170\/dataset$/);
  });

  it('bila WABA ditolak, mencoba dataset milik Facebook Page', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(403, '{"error":{"message":"(#200) missing whatsapp_business_manage_events"}}'))
      .mockResolvedValueOnce(reply(200, '{"id":"888"}'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(ownerDataset()).resolves.toMatchObject({ datasetId: '888', owner: 'Facebook Page' });
    expect(String((fetchMock.mock.calls[1] as unknown[])[0])).toMatch(/\/101\/dataset$/);
  });

  it('semua ditolak: pesan Meta dan izin yang dibutuhkan ditampilkan', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(403, '{"error":{"message":"(#200) Permissions error"}}')));
    await expect(ownerDataset()).rejects.toThrow(/whatsapp_business_manage_events.*Permissions error.*page_events/);
  });

  it('butuh token serta WABA ID atau Page ID', async () => {
    mocks.brand.mockResolvedValue({ facebookPageId: null, metaWabaId: null, metaAccessToken: 'enc', metaPixelId: '640' });
    await expect(ownerDataset()).rejects.toThrow(/WABA ID atau Facebook Page ID/);
  });
});
