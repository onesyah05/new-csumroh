import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { assignedBrandIds, canAccessBrand, isHoldingWide, scopedBrandId, visibleBrandIds } from './auth.js';

const ALSHA = 3;
const HANA = 1;
const NAVA = 6;

const user = (role: string, brandId: number | null, brands: number[] = []) => ({
  id: 1, name: 'U', email: 'u@x.id', role, brandId, brand: null,
  userBrands: brands.map((id) => ({ brand: { id } })),
}) as never;
const req = (u: unknown) => ({ user: u }) as Request;

describe('scope brand: Admin yang punya brand bukan pengawas holding', () => {
  it('Admin Alsha (Lia) hanya memegang Alsha', () => {
    const lia = user('admin', ALSHA, [ALSHA]);
    expect(isHoldingWide(lia)).toBe(false);
    expect(visibleBrandIds(lia)).toEqual([ALSHA]);
    expect(canAccessBrand(lia, ALSHA)).toBe(true);
    expect(canAccessBrand(lia, HANA)).toBe(false);
    expect(canAccessBrand(lia, NAVA)).toBe(false);
  });

  it('scopedBrandId menolak brand lain untuk Admin yang punya brand, tapi menerima brand sendiri', () => {
    const lia = user('admin', ALSHA, [ALSHA]);
    expect(scopedBrandId(req(lia), ALSHA)).toBe(ALSHA);
    expect(() => scopedBrandId(req(lia), HANA)).toThrow(/tidak diizinkan/);
    expect(scopedBrandId(req(lia))).toBe(ALSHA);
  });

  it('Admin dengan dua brand memegang keduanya saja', () => {
    const admin = user('admin', HANA, [HANA, NAVA]);
    expect(visibleBrandIds(admin)).toEqual([HANA, NAVA]);
    expect(() => scopedBrandId(req(admin), ALSHA)).toThrow();
    expect(scopedBrandId(req(admin), NAVA)).toBe(NAVA);
  });

  it('Admin tanpa brand sama sekali, Superadmin, dan Finance tetap holding (semua brand)', () => {
    for (const holding of [user('admin', null), user('superadmin', null), user('finance', null)]) {
      expect(isHoldingWide(holding)).toBe(true);
      expect(visibleBrandIds(holding)).toBeNull();
      expect(canAccessBrand(holding, NAVA)).toBe(true);
      expect(scopedBrandId(req(holding), NAVA)).toBe(NAVA);
    }
  });

  it('CS tetap dibatasi ke brand tugasnya', () => {
    const cs = user('cs', HANA, [HANA, NAVA]);
    expect(assignedBrandIds(cs).sort()).toEqual([HANA, NAVA]);
    expect(() => scopedBrandId(req(cs), ALSHA)).toThrow();
  });
});
