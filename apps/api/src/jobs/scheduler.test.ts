import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claimed: new Set<string>(),
  runs: [] as string[],
  releaseCapi: null as null | (() => void),
  retentionFailures: 0,
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
    retentionJob: async () => {
      mocks.runs.push('retention');
      if (mocks.retentionFailures > 0) { mocks.retentionFailures -= 1; throw new Error('database sedang bermasalah'); }
    },
    releaseClaim: async (key: string) => { mocks.claimed.delete(key); },
  };
});
vi.mock('../modules/notifications/notification.events.js', () => ({ notifyWhatsappDisconnected: vi.fn() }));
vi.mock('../modules/capi/capi.service.js', () => ({
  capiSyncJob: async () => {
    mocks.runs.push('capi-sync');
    if (mocks.releaseCapi === null) await new Promise<void>((resolve) => { mocks.releaseCapi = resolve; });
  },
}));
vi.mock('../modules/chat/chat.routes.js', () => ({ getLivechatConversationsForBrand: vi.fn() }));
vi.mock('../db/prisma.js', () => ({ prisma: {} }));

import { backgroundJobsSettled, runTick } from './scheduler.js';

beforeEach(async () => {
  mocks.releaseCapi?.();
  mocks.releaseCapi = () => undefined;
  await backgroundJobsSettled();
  mocks.claimed.clear();
  mocks.runs = [];
  mocks.retentionFailures = 0;
});

describe('scheduler', () => {
  it('sinkron CAPI yang lambat tidak menahan job menit berikutnya dan tidak jalan tumpang tindih', async () => {
    mocks.releaseCapi = null; // capi-sync menggantung sampai dilepas
    await runTick(new Date('2026-09-24T02:00:00Z'));
    await runTick(new Date('2026-09-24T02:01:00Z'));
    expect(mocks.runs.filter((r) => r === 'reply-sla')).toHaveLength(2);
    expect(mocks.runs.filter((r) => r === 'capi-sync')).toHaveLength(1);
    mocks.releaseCapi!();
    await backgroundJobsSettled();
  });

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

  it('job harian yang gagal dicoba lagi di putaran berikutnya, maksimal 3 kali per hari', async () => {
    mocks.retentionFailures = 2;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await runTick(new Date('2026-09-25T00:30:00Z'));
    await runTick(new Date('2026-09-25T00:31:00Z'));
    await runTick(new Date('2026-09-25T00:32:00Z'));
    // Gagal, gagal, sukses; setelah sukses klaim tetap dan tidak dijalankan lagi.
    await runTick(new Date('2026-09-25T00:33:00Z'));
    expect(mocks.runs.filter((r) => r === 'retention')).toHaveLength(3);
  });

  it('gagal terus: berhenti setelah 3 percobaan hari itu', async () => {
    mocks.retentionFailures = 99;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (let minute = 0; minute < 6; minute += 1) await runTick(new Date(Date.UTC(2026, 8, 26, 0, 30 + minute)));
    expect(mocks.runs.filter((r) => r === 'retention')).toHaveLength(3);
  });
});
