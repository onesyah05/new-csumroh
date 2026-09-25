import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claimed: new Set<string>(),
  runs: [] as string[],
}));

vi.mock('../modules/notifications/jobs.js', async () => {
  const actual = await vi.importActual<typeof import('../modules/notifications/jobs.js')>('../modules/notifications/jobs.js');
  const job = (name: string) => async () => { mocks.runs.push(name); };
  return {
    SLA: actual.SLA,
    businessHour: actual.businessHour,
    claimOnce: async (key: string) => (mocks.claimed.has(key) ? false : (mocks.claimed.add(key), true)),
    replySlaJob: job('reply-sla'),
    whatsappDisconnectedJob: job('wa-disconnected'),
    gatewayHealthJob: job('gateway-health'),
    proofStaleJob: job('proof-stale'),
    customExpiringJob: job('custom-expiring'),
    morningDigestJob: job('morning-digest'),
    eveningDigestJob: job('evening-digest'),
    retentionJob: job('retention'),
  };
});
vi.mock('../modules/notifications/notification.events.js', () => ({ notifyWhatsappDisconnected: vi.fn() }));
vi.mock('../modules/chat/chat.routes.js', () => ({ getLivechatConversationsForBrand: vi.fn() }));
vi.mock('../db/prisma.js', () => ({ prisma: {} }));

import { runTick } from './scheduler.js';

beforeEach(() => {
  mocks.claimed.clear();
  mocks.runs = [];
});

describe('scheduler', () => {
  it('satu putaran per menit walau dipanggil dua kali (proses kedua dilewati)', async () => {
    const at = new Date('2026-09-24T02:00:10Z'); // 09.00 WIB
    expect(await runTick(at)).toBe(true);
    expect(await runTick(new Date('2026-09-24T02:00:40Z'))).toBe(false);
    expect(mocks.runs.filter((r) => r === 'reply-sla')).toHaveLength(1);
  });

  it('job harian jalan sekali per tanggal WIB setelah jamnya, termasuk menyusul', async () => {
    await runTick(new Date('2026-09-24T00:30:00Z')); // 07.30 WIB: sebelum pagi, retensi (03.00) sudah lewat
    expect(mocks.runs).toContain('retention');
    expect(mocks.runs).not.toContain('morning-digest');
    await runTick(new Date('2026-09-24T01:05:00Z')); // 08.05 WIB
    await runTick(new Date('2026-09-24T01:06:00Z'));
    expect(mocks.runs.filter((r) => r === 'morning-digest')).toHaveLength(1);
    expect(mocks.runs.filter((r) => r === 'retention')).toHaveLength(1);
    expect(mocks.runs).not.toContain('evening-digest');
  });
});
