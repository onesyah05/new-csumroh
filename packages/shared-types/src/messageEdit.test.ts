import { describe, expect, it } from 'vitest';
import { EDIT_BLOCK_STATUS, EDIT_TEXT_PROBLEM_STATUS, EDIT_WINDOW_SECONDS, editMenuState, editTextProblem, isEditAuthor, messageEditBlock } from './messageEdit.js';

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

describe('Siapa yang boleh mengedit', () => {
  it('Admin/Superadmin selalu; CS hanya bila PIC percakapan itu', () => {
    expect(isEditAuthor({ role: 'admin', userId: 1, picUserId: 10 })).toBe(true);
    expect(isEditAuthor({ role: 'superadmin', userId: 1, picUserId: null })).toBe(true);
    expect(isEditAuthor({ role: 'cs', userId: 10, picUserId: 10 })).toBe(true);
    expect(isEditAuthor({ role: 'cs', userId: 11, picUserId: 10 })).toBe(false);
    expect(isEditAuthor({ role: 'cs', userId: 11, picUserId: null })).toBe(false);
    expect(isEditAuthor({ role: 'cs', userId: undefined, picUserId: undefined })).toBe(false);
  });
});

describe('Status penolakan', () => {
  it('tiap alasan dan masalah punya kode HTTP', () => {
    expect(EDIT_BLOCK_STATUS).toEqual({ not_mine: 400, not_text: 400, deleted: 409, not_in_whatsapp: 422, expired: 422 });
    expect(EDIT_TEXT_PROBLEM_STATUS).toEqual({ empty: 400, too_long: 400, unchanged: 409 });
  });
});

describe('Keadaan menu Edit', () => {
  const message = (overrides: Record<string, unknown> = {}) => ({ id: 1, isFromMe: true, isDeleted: false, messageType: 'conversation', messageId: 'WA1', messageText: 'halo', timestamp: now - 60, ...overrides });
  const author = { canEdit: true, picName: 'Aisyah' };

  it('aktif untuk pesan teks sendiri dalam 15 menit oleh Admin/PIC', () => {
    expect(editMenuState(message(), author, now)).toEqual({ visible: true, enabled: true, label: null, reason: null });
  });

  it('tersembunyi untuk pesan jamaah, terhapus, dan bukan teks', () => {
    expect(editMenuState(message({ isFromMe: false }), author, now).visible).toBe(false);
    expect(editMenuState(message({ isDeleted: true }), author, now).visible).toBe(false);
    expect(editMenuState(message({ messageType: 'imageMessage' }), author, now).visible).toBe(false);
  });

  it('tampil tetapi nonaktif dengan alasan: lewat 15 menit, tidak tercatat di WhatsApp, bukan Admin/PIC', () => {
    expect(editMenuState(message({ timestamp: now - 20 * 60 }), author, now)).toMatchObject({ visible: true, enabled: false, label: 'Lewat 15 menit' });
    expect(editMenuState(message({ messageId: 'local-1' }), author, now)).toMatchObject({ enabled: false, label: 'Tidak tercatat di WhatsApp' });
    const notPic = editMenuState(message(), { canEdit: false, picName: 'Aisyah' }, now);
    expect(notPic).toMatchObject({ enabled: false, label: 'Hanya Admin/PIC' });
    expect((notPic as { reason: string }).reason).toContain('Aisyah');
  });

  it('bukan Admin/PIC sekaligus lewat 15 menit: tooltip menyebut keduanya', () => {
    const both = editMenuState(message({ timestamp: now - 20 * 60 }), { canEdit: false, picName: null }, now);
    expect((both as { reason: string }).reason).toContain('Hanya Admin dan PIC (CS lain)');
    expect((both as { reason: string }).reason).toContain('Lewat 15 menit');
  });
});
