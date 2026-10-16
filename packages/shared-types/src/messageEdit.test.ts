import { describe, expect, it } from 'vitest';
import { EDIT_WINDOW_SECONDS, editTextProblem, messageEditBlock } from './messageEdit.js';

const now = 1_790_000_000;
const mine = (overrides: Record<string, unknown> = {}) => ({ isFromMe: true, isDeleted: false, messageType: 'conversation', messageId: 'WA123', timestamp: now - 60, ...overrides });

describe('Pesan yang boleh diedit', () => {
  it('pesan teks milik kita dalam 15 menit boleh', () => {
    expect(messageEditBlock(mine(), now)).toBeNull();
    expect(messageEditBlock(mine({ messageType: 'extendedTextMessage' }), now)).toBeNull();
    expect(messageEditBlock(mine({ timestamp: now - EDIT_WINDOW_SECONDS }), now)).toBeNull();
  });

  it('lewat 15 menit, pesan jamaah, terhapus, bukan teks, dan pesan lokal/panggilan ditolak dengan alasannya', () => {
    expect(messageEditBlock(mine({ timestamp: now - EDIT_WINDOW_SECONDS - 1 }), now)).toBe('expired');
    expect(messageEditBlock(mine({ isFromMe: false }), now)).toBe('not_mine');
    expect(messageEditBlock(mine({ isDeleted: true }), now)).toBe('deleted');
    expect(messageEditBlock(mine({ messageType: 'imageMessage' }), now)).toBe('not_text');
    expect(messageEditBlock(mine({ messageType: 'documentMessage' }), now)).toBe('not_text');
    expect(messageEditBlock(mine({ messageId: 'local-abc' }), now)).toBe('not_in_whatsapp');
    expect(messageEditBlock(mine({ messageId: 'call-1' }), now)).toBe('not_in_whatsapp');
  });
});

describe('Teks hasil edit', () => {
  it('kosong, hanya spasi, terlalu panjang, dan tidak berubah ditolak', () => {
    expect(editTextProblem('   ', 'halo')).toBe('empty');
    expect(editTextProblem('a'.repeat(4001), 'halo')).toBe('too_long');
    expect(editTextProblem('halo', 'halo')).toBe('unchanged');
    expect(editTextProblem('  halo ', 'halo')).toBe('unchanged');
  });

  it('teks berbeda (termasuk batas 4.000 karakter) diterima', () => {
    expect(editTextProblem('halo, selamat pagi', 'halo')).toBeNull();
    expect(editTextProblem('a'.repeat(4000), 'halo')).toBeNull();
    expect(editTextProblem('baru', null)).toBeNull();
  });
});
