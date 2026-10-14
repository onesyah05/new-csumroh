import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRefreshBatcher } from './refreshBatcher';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('penggabung muat ulang realtime', () => {
  it('kunci yang sama dalam satu jendela hanya dimuat ulang sekali', () => {
    const invalidate = vi.fn();
    const batcher = createRefreshBatcher({ delayMs: 1_500, invalidate });
    for (let i = 0; i < 20; i += 1) batcher.add('conversations');
    batcher.add('messages');
    expect(invalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_500);
    expect(invalidate.mock.calls.map(([key]) => key).sort()).toEqual(['conversations', 'messages']);
  });

  it('data berat menunggu tab terlihat, lalu dimuat saat flush', () => {
    const invalidate = vi.fn();
    let visible = false;
    const batcher = createRefreshBatcher({ delayMs: 10_000, onlyWhenVisible: true, invalidate, isVisible: () => visible });
    batcher.add('prospects');
    vi.advanceTimersByTime(10_000);
    expect(invalidate).not.toHaveBeenCalled();
    expect(batcher.pending).toBe(1);
    visible = true;
    batcher.flush();
    expect(invalidate).toHaveBeenCalledWith('prospects');
    expect(batcher.pending).toBe(0);
  });

  it('dispose membatalkan yang menunggu', () => {
    const invalidate = vi.fn();
    const batcher = createRefreshBatcher({ delayMs: 1_000, invalidate });
    batcher.add('dashboard');
    batcher.dispose();
    vi.advanceTimersByTime(5_000);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('chat ramai: Pipeline dimuat paling sering sekali per 10 detik, bukan tiap 1,5 detik', () => {
    const invalidate = vi.fn();
    const heavy = createRefreshBatcher({ delayMs: 10_000, onlyWhenVisible: true, invalidate, isVisible: () => true });
    for (let second = 0; second < 30; second += 1) {
      heavy.add('prospects');
      vi.advanceTimersByTime(1_000);
    }
    expect(invalidate.mock.calls.filter(([key]) => key === 'prospects').length).toBeLessThanOrEqual(3);
  });
});
