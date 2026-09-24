import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));
vi.mock('../../db/prisma.js', () => ({ prisma: { whatsappSession: { findUnique: mocks.findUnique, update: mocks.update } } }));
vi.mock('../../middleware/auth.js', () => ({
  authGuard: (_req: any, _res: any, next: any) => next(),
  scopedBrandId: (_req: any, requested?: number) => requested ?? 1,
}));
vi.mock('../notifications/notification.events.js', () => ({ dispatch: vi.fn(), notifyProspectsReleased: vi.fn(), onWhatsappStatus: vi.fn(), notifyPicChange: vi.fn(), resolveReplyNotifications: vi.fn() }));
vi.mock('../../realtime/socket.js', () => ({ emitToBrand: vi.fn() }));

import { chatRouter } from './chat.routes.js';

function status(role: string) {
  const layer = (chatRouter as any).stack.find((l: any) => l.route?.path === '/wa/status' && l.route.methods.get);
  return new Promise<any>((resolve, reject) => {
    const res = { json: (body: any) => resolve(body.data), status: () => res };
    layer.route.stack.at(-1).handle({ query: { brandId: '1' }, user: { id: 1, role } }, res, reject);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue({ brandId: 1, status: 'connected', phoneNumber: '62811', qrCode: 'QR-SECRET' });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: { status: 'connected' } }) })));
});

describe('Status WhatsApp untuk Inbox (semua role)', () => {
  it('CS and Finance get the connection status (no role gate) but never the pairing QR', async () => {
    for (const role of ['cs', 'finance']) {
      const data = await status(role);
      expect(data.status).toBe('connected');
      expect(data.qrCode).toBeNull();
    }
  });

  it('device managers still receive the QR', async () => {
    expect((await status('admin')).qrCode).toBe('QR-SECRET');
    expect((await status('superadmin')).qrCode).toBe('QR-SECRET');
  });
});
