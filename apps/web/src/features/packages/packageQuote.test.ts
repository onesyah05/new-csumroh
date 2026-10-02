import { describe, expect, it } from 'vitest';
import { waBullets } from '../chat/waFormat';
import { formatWaPackageSummary } from './packageQuote';

const lines = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n');

describe('Daftar fasilitas di pesan WhatsApp', () => {
  it('selalu lengkap, tanpa "dan N lainnya (lihat brosur)"', () => {
    expect(waBullets(lines(19, 'Fasilitas'))).toHaveLength(19);
    const text = formatWaPackageSummary({ name: 'Umroh Reguler', priceQuad: 'Rp 39.499.000', facilitiesIncluded: lines(19, 'Fasilitas'), facilitiesExcluded: lines(7, 'Biaya') });
    expect(text).not.toMatch(/lainnya|lihat brosur/);
    expect(text).toContain('• Fasilitas 19');
    // Biaya yang belum termasuk tidak pernah disembunyikan.
    expect(text).toContain('• Biaya 7');
  });
});
