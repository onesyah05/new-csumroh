import { describe, expect, it } from 'vitest';
import { messageInputSchema } from './contracts.js';

describe('messageInputSchema', () => {
  it('membalas pesan panjang (mis. ringkasan paket 1.500 karakter) tidak ditolak', () => {
    const longPackageSummary = `*Umroh Promo Fantastic *3* Berangkat 11 Januari 2027 · 9 Hari*\n${'Harga termasuk tiket, hotel, visa. '.repeat(45)}`;
    expect(longPackageSummary.length).toBeGreaterThan(1500);
    const input = messageInputSchema.parse({ prospectId: 1, text: 'Masih sesuai detail list ini ya kak', quotedMessageId: 'ABC', quotedText: longPackageSummary });
    // Kutipan hanya pratinjau: dipotong, bukan alasan menolak balasan.
    expect(longPackageSummary.startsWith(input.quotedText!)).toBe(true);
  });

  it('kutipan yang melebihi batas pesan dipotong ke 4.000 karakter', () => {
    const input = messageInputSchema.parse({ prospectId: 1, text: 'ok', quotedText: 'x'.repeat(9000) });
    expect(input.quotedText).toHaveLength(4000);
  });
});
