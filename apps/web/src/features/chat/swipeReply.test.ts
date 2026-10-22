import { describe, expect, it } from 'vitest';
import { SWIPE_REPLY_MAX, SWIPE_REPLY_THRESHOLD, classifySwipe, isSwipeReplyTriggered, swipeOffset } from './swipeReply';

describe('geser untuk membalas', () => {
  it('gerak kecil belum menentukan arah', () => expect(classifySwipe(4, 2)).toBe('pending'));
  it('geser kanan, termasuk yang agak miring, dihitung', () => {
    expect(classifySwipe(30, 8)).toBe('swipe');
    expect(classifySwipe(30, 25)).toBe('swipe');
  });
  it('scroll vertikal, geser kiri, atau lebih curam dari 45 derajat dilepas ke browser', () => {
    expect(classifySwipe(5, 40)).toBe('ignore');
    expect(classifySwipe(-40, 2)).toBe('ignore');
    expect(classifySwipe(25, 30)).toBe('ignore');
  });
  it('bubble mengikuti jari sampai ambang, lalu makin berat dan berhenti di batas', () => {
    expect(swipeOffset(-10)).toBe(0);
    expect(swipeOffset(40)).toBe(40);
    expect(swipeOffset(SWIPE_REPLY_THRESHOLD)).toBe(SWIPE_REPLY_THRESHOLD);
    expect(swipeOffset(SWIPE_REPLY_THRESHOLD + 50)).toBeLessThan(SWIPE_REPLY_THRESHOLD + 50);
    expect(swipeOffset(1000)).toBe(SWIPE_REPLY_MAX);
  });
  it('balas terpicu hanya setelah melewati ambang', () => {
    expect(isSwipeReplyTriggered(SWIPE_REPLY_THRESHOLD - 1)).toBe(false);
    expect(isSwipeReplyTriggered(SWIPE_REPLY_THRESHOLD)).toBe(true);
  });
});
