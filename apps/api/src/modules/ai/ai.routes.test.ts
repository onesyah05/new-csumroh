import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: { enabled: true, apiKey: 'sk-ant-test-key-abcd', model: 'claude-haiku-5-5', pilotUserIds: [] as number[], dailyLimitPerUser: 150, updatedById: null, updatedAt: null },
  prospectFind: vi.fn(), prospectMany: vi.fn(), messages: vi.fn(), brand: vi.fn(), pkg: vi.fn(),
  count: vi.fn(), create: vi.fn(), findSuggestion: vi.fn(), update: vi.fn(), suggest: vi.fn(),
}));

vi.mock('../../config/env.js', () => ({ env: { NODE_ENV: 'test', AI_TIMEOUT_MS: 20000, AI_DAILY_LIMIT_GLOBAL: 3000 } }));
vi.mock('./settings.js', async () => {
  const actual = await vi.importActual<typeof import('./settings.js')>('./settings.js');
  return { ...actual, getAiConfig: async () => mocks.config };
});
vi.mock('../../db/prisma.js', () => ({
  prisma: {
    prospect: { findFirst: mocks.prospectFind, findMany: mocks.prospectMany },
    chatMessage: { findMany: mocks.messages },
    brand: { findUniqueOrThrow: mocks.brand },
    package: { findFirst: mocks.pkg },
    aiSuggestion: { count: mocks.count, create: mocks.create, findFirst: mocks.findSuggestion, update: mocks.update },
  },
}));
vi.mock('../chat/device-scope.js', () => ({ visibleProspectWhere: async () => ({ OR: [{ brandId: 1, devicePhone: '62811' }] }) }));
vi.mock('./suggest.service.js', () => ({ suggestReplies: mocks.suggest }));
vi.mock('../../middleware/auth.js', async () => {
  const actual = await vi.importActual<typeof import('../../middleware/auth.js')>('../../middleware/auth.js');
  return { ...actual, authGuard: (_req: unknown, _res: unknown, next: () => void) => next() };
});

import { env } from '../../config/env.js';
import { aiRouter, startOfBusinessDay } from './ai.routes.js';

type Actor = { id: number; role: string; brandId: number | null; name: string };
const cs = (id = 7): Actor => ({ id, role: 'cs', brandId: 1, name: 'Fitri' });

function call(method: 'get' | 'post', path: string, user: Actor, opts: { body?: unknown; params?: Record<string, string> } = {}) {
  const layer = (aiRouter as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
  return new Promise<{ status: number; body?: any; error?: any }>((resolve) => {
    const res: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(body: any) { resolve({ status: this.statusCode, body }); } };
    layer.route.stack.at(-1).handle(
      { params: opts.params ?? {}, body: opts.body ?? {}, query: {}, user },
      res,
      (error: any) => resolve({ status: error?.status ?? 500, error }),
    );
  });
}

const prospect = (overrides: Record<string, unknown> = {}) => ({
  id: 5, brandId: 1, userId: 7, status: 'objection', name: 'Siti', phone: '62812', remoteJid: '62812@s.whatsapp.net', devicePhone: '62811',
  packageId: null, objectionCategory: null, objectionNotes: null, ...overrides,
});
const aiResult = {
  source: 'ai', fallbackReason: null, detected: { intent: 'objection', objection: 'harga', coverage: 'partial', needsInternalInfo: false, stageLabel: 'Keberatan' },
  options: [{ approach: 'Empati', origin: 'adapted', template: 'Halo {{paket}}', text: 'Halo {{paket}}', status: 'blocked', reasons: [], missing: [] }],
  model: 'claude-haiku-5-5', inputTokens: 100, outputTokens: 50,
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.config, { enabled: true, pilotUserIds: [], dailyLimitPerUser: 150 });
  mocks.prospectFind.mockResolvedValue(prospect());
  mocks.prospectMany.mockResolvedValue([{ id: 5 }]);
  mocks.messages.mockResolvedValue([{ isFromMe: false, messageType: 'conversation', messageText: 'Mahal ya' }]);
  mocks.brand.mockResolvedValue({ id: 1, name: 'Hana Tours', ppiuNumber: null, bankName: null, bankAccountNumber: null, bankAccountHolder: null });
  mocks.count.mockResolvedValue(0);
  mocks.create.mockResolvedValue({ id: 46 });
  mocks.suggest.mockResolvedValue(aiResult);
});

describe('Saran Balasan AI', () => {
  it('status mengikuti saklar, role, dan daftar pilot', async () => {
    expect((await call('get', '/status', cs())).body.data.enabled).toBe(true);
    expect((await call('get', '/status', { ...cs(), role: 'finance' })).body.data.enabled).toBe(false);
    mocks.config.pilotUserIds = [12];
    expect((await call('get', '/status', cs(7))).body.data.enabled).toBe(false);
    expect((await call('get', '/status', cs(12))).body.data.enabled).toBe(true);
    mocks.config.enabled = false;
    expect((await call('get', '/status', cs(12))).body.data.enabled).toBe(false);
  });

  it('menolak bila dimatikan, bukan peserta pilot, atau role finance/product', async () => {
    mocks.config.enabled = false;
    expect((await call('post', '/reply-suggestions', cs(), { body: { prospectId: 5 } })).status).toBe(503);
    mocks.config.enabled = true;
    mocks.config.pilotUserIds = [12];
    expect((await call('post', '/reply-suggestions', cs(7), { body: { prospectId: 5 } })).status).toBe(403);
    mocks.config.pilotUserIds = [];
    expect((await call('post', '/reply-suggestions', { ...cs(), role: 'product' }, { body: { prospectId: 5 } })).status).toBe(403);
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it('hanya PIC atau prospek tanpa PIC; prospek di luar device aktif tidak ditemukan', async () => {
    mocks.prospectFind.mockResolvedValueOnce(prospect({ userId: 9 }));
    expect((await call('post', '/reply-suggestions', cs(7), { body: { prospectId: 5 } })).status).toBe(403);
    mocks.prospectFind.mockResolvedValueOnce(null);
    expect((await call('post', '/reply-suggestions', cs(7), { body: { prospectId: 5 } })).status).toBe(404);
    // Query prospek dibatasi brand dan device aktif.
    expect(mocks.prospectFind.mock.calls[1][0].where.AND).toEqual([{ id: 5, brandId: 1 }, { OR: [{ brandId: 1, devicePhone: '62811' }] }]);
    mocks.prospectFind.mockResolvedValueOnce(prospect({ userId: null }));
    expect((await call('post', '/reply-suggestions', cs(7), { body: { prospectId: 5 } })).status).toBe(200);
  });

  it('menolak prospek yang sudah deal, tanpa pesan masuk, atau melewati batas harian', async () => {
    mocks.prospectFind.mockResolvedValueOnce(prospect({ status: 'deal' }));
    expect((await call('post', '/reply-suggestions', cs(), { body: { prospectId: 5 } })).status).toBe(409);
    mocks.messages.mockResolvedValueOnce([{ isFromMe: true, messageType: 'conversation', messageText: 'Halo' }]);
    expect((await call('post', '/reply-suggestions', cs(), { body: { prospectId: 5 } })).status).toBe(409);
    mocks.count.mockResolvedValueOnce(150);
    expect((await call('post', '/reply-suggestions', cs(), { body: { prospectId: 5 } })).status).toBe(429);
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it('plafon harian seluruh tim: permintaan AI ditolak walau kuota pribadi masih ada', async () => {
    mocks.count.mockResolvedValueOnce(3).mockResolvedValueOnce(env.AI_DAILY_LIMIT_GLOBAL);
    const result = await call('post', '/reply-suggestions', cs(), { body: { prospectId: 5 } });
    expect(result.status).toBe(429);
    expect(result.error.message).toContain('seluruh tim');
    expect(mocks.suggest).not.toHaveBeenCalled();
    // Hanya permintaan yang memanggil penyedia AI yang dihitung.
    expect(mocks.count.mock.calls[1]![0].where).toMatchObject({ source: 'ai' });
  });

  it('mengembalikan saran dan menyimpan log tanpa teks final', async () => {
    const result = await call('post', '/reply-suggestions', cs(), { body: { prospectId: 5, instruction: ' lebih singkat ' } });
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ suggestionId: 46, source: 'ai', detected: { objection: 'harga' } });
    expect(mocks.suggest.mock.calls[0][0].instruction).toBe('lebih singkat');
    const saved = mocks.create.mock.calls[0][0].data;
    expect(saved).toMatchObject({ brandId: 1, prospectId: 5, userId: 7, source: 'ai', instruction: 'lebih singkat', inputTokens: 100 });
    expect(saved.options).toEqual([{ approach: 'Empati', origin: 'adapted', template: 'Halo {{paket}}', status: 'blocked' }]);
    // Pesan dibaca dari device prospek, tanpa pesan terhapus.
    expect(mocks.messages.mock.calls[0][0].where).toMatchObject({ brandId: 1, prospectId: { in: [5] }, isDeleted: false, devicePhone: '62811' });
  });

  it('feedback hanya untuk saran milik user sendiri', async () => {
    mocks.findSuggestion.mockResolvedValueOnce(null);
    expect((await call('post', '/reply-suggestions/:id/feedback', cs(), { params: { id: '46' }, body: { action: 'used', optionIndex: 0, similarity: 0.8 } })).status).toBe(404);
    mocks.findSuggestion.mockResolvedValueOnce({ id: 46, userId: 7 });
    expect((await call('post', '/reply-suggestions/:id/feedback', cs(), { params: { id: '46' }, body: { action: 'used', optionIndex: 0, similarity: 0.8 } })).status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ action: 'used', optionIndex: 0, similarity: 0.8 });
    // Aksi tidak dikenal ditolak validasi (errorHandler memetakan ZodError ke 422).
    expect((await call('post', '/reply-suggestions/:id/feedback', cs(), { params: { id: '46' }, body: { action: 'copy' } })).error?.name).toBe('ZodError');
  });
});

describe('startOfBusinessDay', () => {
  it('memakai tengah malam WIB', () => {
    expect(startOfBusinessDay(new Date('2026-10-13T16:30:00Z')).toISOString()).toBe('2026-10-12T17:00:00.000Z');
    expect(startOfBusinessDay(new Date('2026-10-13T17:30:00Z')).toISOString()).toBe('2026-10-13T17:00:00.000Z');
  });
});
