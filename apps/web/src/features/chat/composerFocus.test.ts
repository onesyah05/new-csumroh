import { describe, expect, it } from 'vitest';
import { composerFocusDecision } from './composerFocus';

const base = { request: { id: 5, at: 1000 }, selectedId: 5, now: 1500, mobile: false, canSend: true, panelOpen: false };

describe('fokus kolom pesan setelah membuka percakapan', () => {
  it('desktop, bisa membalas, tanpa panel: fokus', () => expect(composerFocusDecision(base)).toBe('focus'));
  it('tanpa permintaan (pilihan berubah sendiri): tidak fokus', () => expect(composerFocusDecision({ ...base, request: null })).toBe('wait'));
  it('permintaan untuk percakapan lain: tidak fokus', () => expect(composerFocusDecision({ ...base, selectedId: 6 })).toBe('wait'));
  it('layout HP: permintaan dibuang', () => expect(composerFocusDecision({ ...base, mobile: true })).toBe('drop'));
  it('belum bisa membalas atau panel terbuka: menunggu', () => {
    expect(composerFocusDecision({ ...base, canSend: false })).toBe('wait');
    expect(composerFocusDecision({ ...base, panelOpen: true })).toBe('wait');
  });
  it('permintaan basi dibuang agar tidak merebut fokus belakangan', () => {
    expect(composerFocusDecision({ ...base, now: 1000 + 3001, canSend: false })).toBe('drop');
  });
});
