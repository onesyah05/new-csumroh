import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@csumroh/shared-types';
import { assignedBrandIds, packageBrandsUnrestricted } from './scope';

const user = (role: string, brandId: number | null, extra: number[] = []) =>
  ({ id: 1, role, brandId, userBrands: extra.map((id) => ({ brand: { id } })) }) as unknown as SessionUser;

describe('Brand paket yang bisa dipilih', () => {
  it('brand tugas tanpa duplikat (brand utama yang juga tercatat sebagai penugasan dihitung sekali)', () => {
    expect(assignedBrandIds(user('admin', 1, [1, 2, 6]))).toEqual([1, 2, 6]);
  });

  it('Superadmin & Finance semua brand; Admin bertugas hanya brand tugasnya; Admin tanpa penugasan semua brand', () => {
    expect(packageBrandsUnrestricted(user('superadmin', null))).toBe(true);
    expect(packageBrandsUnrestricted(user('finance', 1))).toBe(true);
    expect(packageBrandsUnrestricted(user('admin', 1, [2, 6]))).toBe(false);
    expect(packageBrandsUnrestricted(user('admin', null))).toBe(true);
    expect(packageBrandsUnrestricted(user('cs', 1, [6]))).toBe(false);
  });
});
