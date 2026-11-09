import { describe, expect, it } from 'vitest';
import type { LeadHandlingRow } from '@csumroh/shared-types';
import { leadSlices } from './LeadsView';

const row = (key: string, name: string, newLeads: number, oldLeads: number): LeadHandlingRow => ({ key, userId: key === 'hp' ? null : Number(key.slice(5)), name, isActive: true, newLeads, oldLeads, medianReplyMinutes: null });

describe('Irisan pie Lead Harian', () => {
  it('5 CS teratas berwarna sendiri, sisanya "Lainnya", "Dari HP" terakhir, irisan nol dibuang', () => {
    const rows = [
      row('user:1', 'A', 9, 1), row('user:2', 'B', 8, 0), row('user:3', 'C', 1, 6), row('user:4', 'D', 2, 2),
      row('user:5', 'E', 0, 3), row('user:6', 'F', 1, 1), row('user:7', 'G', 1, 0), row('user:8', 'H', 0, 0),
      row('hp', 'Dari HP (tanpa nama)', 4, 0),
    ];
    const slices = leadSlices(rows, 'newLeads');
    expect(slices.map((s) => [s.label, s.value])).toEqual([['A', 9], ['B', 8], ['D', 2], ['C', 1], ['Lainnya', 2], ['Dari HP (tanpa nama)', 4]]);
    // Warna mengikuti peringkat total, sama di kedua pie.
    const old = leadSlices(rows, 'oldLeads');
    expect(old.find((s) => s.label === 'C')!.color).toBe(slices.find((s) => s.label === 'C')!.color);
    expect(old.map((s) => s.label)).toEqual(['C', 'E', 'D', 'A', 'Lainnya']);
  });
});
