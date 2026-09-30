import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Outbox, type OutboxItem, type SendResult } from './outbox.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'outbox-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
};

describe('Outbox gateway → API', () => {
  it('menahan event selama API mati, lalu mengirimnya berurutan setelah API hidup', async () => {
    let apiUp = false;
    const delivered: unknown[] = [];
    const outbox = new Outbox(dir, async (item: OutboxItem): Promise<SendResult> => {
      if (!apiUp) return 'retry';
      delivered.push(item.payload);
      return 'delivered';
    }, { baseDelayMs: 5, maxDelayMs: 10 });
    await outbox.init();
    await outbox.enqueue({ pathname: '/messages/incoming', payload: 1 });
    await outbox.enqueue({ pathname: '/messages/incoming', payload: 2 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(delivered).toEqual([]);
    expect(outbox.size).toBe(2);
    apiUp = true;
    await waitFor(() => outbox.size === 0);
    expect(delivered).toEqual([1, 2]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('antrean bertahan saat gateway restart', async () => {
    const first = new Outbox(dir, async () => 'retry', { baseDelayMs: 1000 });
    await first.init();
    await first.enqueue({ pathname: '/messages/incoming', payload: 'A' });
    const delivered: unknown[] = [];
    const second = new Outbox(dir, async (item) => { delivered.push(item.payload); return 'delivered'; });
    await second.init();
    await waitFor(() => second.size === 0);
    expect(delivered).toEqual(['A']);
  });

  it('event yang ditolak permanen dibuang agar tidak menahan antrean', async () => {
    const dropped: unknown[] = [];
    const delivered: unknown[] = [];
    const outbox = new Outbox(dir, async (item) => {
      if (item.payload === 'bad') return 'drop';
      delivered.push(item.payload);
      return 'delivered';
    }, { onDrop: (item) => dropped.push(item.payload) });
    await outbox.init();
    await outbox.enqueue({ pathname: '/x', payload: 'bad' });
    await outbox.enqueue({ pathname: '/x', payload: 'ok' });
    await waitFor(() => outbox.size === 0);
    expect(dropped).toEqual(['bad']);
    expect(delivered).toEqual(['ok']);
  });
});
