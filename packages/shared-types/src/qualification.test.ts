import { describe, expect, it } from 'vitest';
import { allTargetMonthKeys, joinExtraMonths, matchPackages, parseExtraMonths, qualificationMissing } from './qualification.js';

describe('syarat kualifikasi', () => {
  it('paspor dan domisili opsional; bulan, 1 dewasa, dan budget wajib', () => {
    expect(qualificationMissing({ targetMonth: '2026-12', paxQuad: 2, budgetRange: '25–30 Juta' })).toEqual([]);
    expect(qualificationMissing({})).toEqual(['Bulan keberangkatan', 'Minimal 1 jamaah dewasa', 'Budget']);
  });
});

describe('bulan tambahan', () => {
  it('parse: hanya YYYY-MM valid, unik, rapi', () => {
    expect(parseExtraMonths('2027-01, 2027-02,2027-01,xx,2027-13')).toEqual(['2027-01', '2027-02']);
    expect(parseExtraMonths(null)).toEqual([]);
    expect(joinExtraMonths(['2027-01', '2027-01', 'bad', '2027-02'])).toBe('2027-01,2027-02');
  });

  it('bulan utama + tambahan tanpa duplikat; tanpa bulan utama hanya tambahan', () => {
    expect(allTargetMonthKeys({ targetMonth: '2026-12', targetMonthsExtra: '2026-12,2027-01' })).toEqual(['2026-12', '2027-01']);
    expect(allTargetMonthKeys({ targetMonth: null, targetMonthsExtra: '2027-01' })).toEqual(['2027-01']);
  });

  it('paket cocok untuk bulan utama maupun tambahan; tanpa bulan utama tidak ada rekomendasi', () => {
    const pkg = (id: number, departureDate: string) => ({ id, name: `Paket ${id}`, isActive: true, departureDate, price: '25000000', quotaRemaining: 10 }) as any;
    const packages = [pkg(1, '2026-12-10'), pkg(2, '2027-01-15'), pkg(3, '2027-03-01')];
    const ids = (p: Record<string, unknown>) => matchPackages(packages, { paxQuad: 2, ...p }).map((m) => m.pkg.id).sort();
    expect(ids({ targetMonth: '2026-12' })).toEqual([1]);
    expect(ids({ targetMonth: '2026-12', targetMonthsExtra: '2027-01' })).toEqual([1, 2]);
    expect(ids({ targetMonth: null, targetMonthsExtra: '2027-01' })).toEqual([]);
  });
});
