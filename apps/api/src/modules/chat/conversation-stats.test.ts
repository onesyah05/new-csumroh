import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db/prisma.js', () => ({ prisma: {} }));
import { summarizeMessages } from './conversation-stats.js';

const msg = (timestamp: number, isFromMe: boolean, status = 'delivered', senderName: string | null = null) => ({ timestamp, isFromMe, status, senderName });

describe('Ringkasan percakapan', () => {
  it('belum dibaca & menunggu sejak: pesan jamaah setelah balasan CS terakhir', () => {
    // Terbaru dulu: jamaah 300 (belum dibaca), 250 (dibaca), CS 200, jamaah 100.
    const s = summarizeMessages([msg(300, false), msg(250, false, 'read', 'Bu Siti'), msg(200, true, 'read'), msg(100, false)]);
    expect(s.latest?.timestamp).toBe(300);
    expect(s.unreadCount).toBe(1);
    expect(s.awaitingSince).toBe(250);
    expect(s.inboundSenderName).toBe('Bu Siti');
  });

  it('pesan terakhir dari CS: tidak ada yang menunggu', () => {
    const s = summarizeMessages([msg(300, true), msg(100, false)]);
    expect(s.unreadCount).toBe(0);
    expect(s.awaitingSince).toBeNull();
  });

  it('percakapan kosong', () => {
    expect(summarizeMessages([])).toEqual({ latest: null, unreadCount: 0, awaitingSince: null, inboundSenderName: null });
  });
});
