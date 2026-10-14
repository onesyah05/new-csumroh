import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ row: null as any, upsert: vi.fn(), findUser: vi.fn(), count: vi.fn(async () => 0), groupBy: vi.fn(async () => []) }));

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    aiSetting: {
      findUnique: async () => mocks.row,
      upsert: mocks.upsert.mockImplementation(async ({ create, update }: any) => { mocks.row = { ...(mocks.row ?? {}), ...(mocks.row ? update : create), updatedAt: new Date() }; return mocks.row; }),
    },
    user: { findUnique: mocks.findUser },
    aiSuggestion: { count: mocks.count, groupBy: mocks.groupBy },
  },
}));
vi.mock('../../middleware/auth.js', async () => {
  const actual = await vi.importActual<typeof import('../../middleware/auth.js')>('../../middleware/auth.js');
  return { ...actual, authGuard: (_req: unknown, _res: unknown, next: () => void) => next() };
});

import { aiRouter } from './ai.routes.js';
import { clearAiConfigCache, getAiConfig, saveAiConfig } from './settings.js';

const KEY = 'sk-ant-api03-contoh-kunci-rahasia-1234';
const base = { enabled: false, model: 'claude-haiku-5-5' as const, pilotUserIds: [], dailyLimitPerUser: 150 };

function layer(method: string, path: string) {
  return (aiRouter as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
}
function run(handle: any, user: any, body: unknown = {}) {
  return new Promise<{ status: number; body?: any; error?: any }>((resolve) => {
    const res: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(data: any) { resolve({ status: this.statusCode, body: data }); } };
    handle({ params: {}, body, query: {}, user }, res, (error: any) => resolve({ status: error?.status ?? (error ? 500 : 200), error }));
  });
}

beforeEach(() => { vi.clearAllMocks(); mocks.row = null; clearAiConfigCache(); });

describe('Pengaturan Asisten AI', () => {
  it('kunci API disimpan terenkripsi dan bisa dibaca kembali oleh server', async () => {
    await saveAiConfig({ ...base, apiKey: KEY }, 1);
    expect(mocks.row.apiKey).toMatch(/^enc:v2:[0-9a-f]{8}:/);
    expect(mocks.row.apiKey).not.toContain('rahasia');
    clearAiConfigCache();
    expect((await getAiConfig()).apiKey).toBe(KEY);
  });

  it('tidak bisa diaktifkan tanpa kunci; kunci lama tetap bila tidak dikirim, null menghapus', async () => {
    await expect(saveAiConfig({ ...base, enabled: true }, 1)).rejects.toMatchObject({ status: 422 });
    await saveAiConfig({ ...base, enabled: true, apiKey: KEY }, 1);
    const kept = await saveAiConfig({ ...base, enabled: true, model: 'claude-sonnet-5-5' }, 1);
    expect(kept).toMatchObject({ enabled: true, apiKey: KEY, model: 'claude-sonnet-5-5' });
    await expect(saveAiConfig({ ...base, enabled: true, apiKey: null }, 1)).rejects.toMatchObject({ status: 422 });
    const cleared = await saveAiConfig({ ...base, apiKey: null }, 1);
    expect(cleared).toMatchObject({ enabled: false, apiKey: null });
  });

  it('hanya Superadmin; respons tidak pernah memuat kunci', async () => {
    const get = layer('get', '/settings');
    expect((await run(get.route.stack[0].handle, { id: 2, role: 'admin' })).status).toBe(403);
    await saveAiConfig({ ...base, enabled: true, apiKey: KEY }, 1);
    const result = await run(get.route.stack.at(-1).handle, { id: 1, role: 'superadmin' });
    expect(result.body.data).toMatchObject({ enabled: true, hasApiKey: true, apiKeyHint: '…1234', model: 'claude-haiku-5-5' });
    expect(JSON.stringify(result.body)).not.toContain('rahasia');
    expect((await run(layer('put', '/settings').route.stack[0].handle, { id: 7, role: 'cs' })).status).toBe(403);
  });
});
