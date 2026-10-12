// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const plays: Array<{ volume: number }> = [];
let rejectPlay = false;

class FakeAudio {
  volume = 1;
  currentTime = 0;
  constructor(public src: string) {}
  play() {
    plays.push({ volume: this.volume });
    return rejectPlay ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
  }
}

async function load() {
  vi.resetModules();
  return import('./notificationSound');
}

beforeEach(() => {
  plays.length = 0;
  rejectPlay = false;
  vi.stubGlobal('Audio', FakeAudio);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('playNotificationSound', () => {
  it('memutar klip mp3 dengan volume terkendali dan resolve true', async () => {
    const { playNotificationSound } = await load();
    await expect(playNotificationSound({ force: true })).resolves.toBe(true);
    expect(plays).toEqual([{ volume: 0.6 }]);
  });

  it('Mendesak memutar klip dua kali', async () => {
    vi.useFakeTimers();
    const { playNotificationSound } = await load();
    await playNotificationSound({ force: true, urgent: true });
    expect(plays).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(plays).toHaveLength(2);
  });

  it('jeda 2 detik: pemutaran kedua tanpa force ditolak', async () => {
    const { playNotificationSound } = await load();
    expect(await playNotificationSound()).toBe(true);
    expect(await playNotificationSound()).toBe(false);
  });

  it('klip diblokir dan WebAudio tidak ada: resolve false (tombol Uji suara menampilkan galat)', async () => {
    rejectPlay = true;
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    const { playNotificationSound } = await load();
    await expect(playNotificationSound({ force: true })).resolves.toBe(false);
  });

  it('klip diblokir tetapi WebAudio ada: memakai nada cadangan', async () => {
    rejectPlay = true;
    const oscillator = { type: '', frequency: { value: 0 }, connect: () => ({ connect: () => undefined }), start: vi.fn(), stop: vi.fn() };
    const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: () => ({ connect: () => undefined }) };
    class FakeContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      createOscillator() { return oscillator; }
      createGain() { return gain; }
      resume() { return Promise.resolve(); }
    }
    vi.stubGlobal('AudioContext', FakeContext);
    const { playNotificationSound } = await load();
    await expect(playNotificationSound({ force: true })).resolves.toBe(true);
    expect(oscillator.start).toHaveBeenCalledTimes(1);
  });
});
