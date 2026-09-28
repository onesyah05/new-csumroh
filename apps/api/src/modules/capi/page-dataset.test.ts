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

function pageDataset() {
  const layer = (capiRouter as any).stack.find((l: any) => l.route?.path === '/page-dataset');
  return new Promise<any>((resolve, reject) => {
    const res = { json: (body: any) => resolve(body.data), status: () => res };
    layer.route.stack.at(-1).handle({ body: { brandId: 1 }, user: { id: 1, role: 'admin' } }, res, reject);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brand.mockResolvedValue({ facebookPageId: '101', metaAccessToken: 'enc', metaPixelId: '640' });
});

describe('Dataset milik Facebook Page', () => {
  it('meminta dataset Page ke Meta tanpa menyimpan apa pun', async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, text: async () => '{"id":"999"}' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(pageDataset()).resolves.toEqual({ datasetId: '999', currentDatasetId: '640', same: false });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/\/101\/dataset$/);
  });

  it('pesan penolakan Meta diteruskan apa adanya', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 403, text: async () => '{"error":{"message":"(#200) Permissions error"}}' })));
    await expect(pageDataset()).rejects.toThrow(/Permissions error.*page_events/);
  });

  it('butuh Page ID dan token tersimpan', async () => {
    mocks.brand.mockResolvedValue({ facebookPageId: null, metaAccessToken: 'enc', metaPixelId: '640' });
    await expect(pageDataset()).rejects.toThrow(/Facebook Page ID/);
  });
});
