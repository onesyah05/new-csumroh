import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  brand: {} as Record<string, any>,
  spam: [] as { phone: string }[],
  brandUpdate: vi.fn(),
}));
vi.mock('../../db/prisma.js', () => ({
  prisma: {
    brand: {
      findUniqueOrThrow: async () => mocks.brand,
      findUnique: async () => mocks.brand,
      update: mocks.brandUpdate,
    },
    prospect: { findMany: async () => mocks.spam },
  },
}));
vi.mock('../capi/meta-token.js', () => ({ decryptMetaToken: () => 'TOKEN' }));

import { hashPhones, SpamAudienceError, syncSpamAudience, updateSpamAudienceMember } from './spam-audience.js';
import { sha256 } from '../capi/capi.payload.js';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe('Audiens spam Meta', () => {
  let calls: { url: string; init: RequestInit }[];
  beforeEach(() => {
    calls = [];
    mocks.brandUpdate.mockReset();
    mocks.brand = { id: 1, metaAdAccountId: '123', metaAccessToken: 'enc', metaSpamAudienceId: null };
    mocks.spam = [{ phone: '0812-3456-789' }, { phone: '62812345678 9' }, { phone: '+62 811 1111 111' }];
  });
  afterEach(() => vi.unstubAllGlobals());

  it('nomor dinormalisasi ke 62… dan di-hash; duplikat dibuang', () => {
    expect(hashPhones(['0812-3456-789', '62812345678 9', '123'])).toEqual([sha256('628123456789')]);
  });

  it('membuat audiens sekali, lalu mengunggah hash nomor (tanpa nomor mentah)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return url.includes('/customaudiences') ? ok({ id: '999' }) : ok({ num_received: 2 });
    }));
    const result = await syncSpamAudience(1);
    expect(result).toMatchObject({ audienceId: '999', phones: 2, received: 2 });
    expect(calls[0]!.url).toContain('/act_123/customaudiences');
    expect(mocks.brandUpdate).toHaveBeenCalledWith({ where: { id: 1 }, data: { metaSpamAudienceId: '999' } });
    const payload = JSON.parse(new URLSearchParams(String(calls[1]!.init.body)).get('payload')!);
    expect(payload.schema).toEqual(['PHONE']);
    expect(payload.data).toEqual([[sha256('628123456789')], [sha256('628111111111')]]);
    expect(String(calls[1]!.init.body)).not.toContain('812345');
  });

  it('galat ketentuan Custom Audience diterjemahkan', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 200, message: 'You must accept the Custom Audience Terms' } }) })));
    await expect(syncSpamAudience(1)).rejects.toThrow(SpamAudienceError);
    await expect(syncSpamAudience(1)).rejects.toThrow(/Ketentuan Custom Audience/);
  });

  it('tandai/batal spam menambah/menghapus satu nomor hanya bila audiens sudah ada', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return ok({ num_received: 1 }); });
    vi.stubGlobal('fetch', fetchMock);
    await updateSpamAudienceMember(1, '081234567', true);
    expect(fetchMock).not.toHaveBeenCalled();
    mocks.brand.metaSpamAudienceId = '999';
    await updateSpamAudienceMember(1, '081234567', true);
    await updateSpamAudienceMember(1, '081234567', false);
    expect(calls.map((c) => [c.url.split('/').slice(-2).join('/'), c.init.method])).toEqual([['999/users', 'POST'], ['999/users', 'DELETE']]);
  });
});
