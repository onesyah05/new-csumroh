import { describe, expect, it } from 'vitest';
import { winningAdIds } from './CreativesView';

const ad = (adId: string, spend: number | null, deals: number, dealValue: number) =>
  ({ adId, spend, deals, dealValue, roas: spend ? dealValue / spend : null });

describe('Tanda konten winning', () => {
  it('deal + ROAS ≥ 1× + ROAS di atas ROAS gabungan periode', () => {
    const rows = [
      ad('A', 2_000_000, 2, 80_000_000), // 40×
      ad('B', 4_000_000, 1, 20_000_000), // 5× (di bawah gabungan 25×)
      ad('C', 1_000_000, 0, 0), // belum deal
      ad('D', null, 3, 90_000_000), // tanpa biaya Meta: tidak dinilai
    ];
    expect([...winningAdIds(rows)]).toEqual(['A']);
  });

  it('tidak ada tanda tanpa data biaya atau bila semua rugi', () => {
    expect(winningAdIds([ad('A', null, 2, 50_000_000)]).size).toBe(0);
    expect(winningAdIds([ad('A', 10_000_000, 1, 5_000_000)]).size).toBe(0);
  });
});
