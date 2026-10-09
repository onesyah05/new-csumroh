import type { SessionUser } from '@csumroh/shared-types';
import { useAuth } from '../app/auth';
import { useUiStore } from '../app/store';

/**
 * Pengawas holding: boleh melihat & memilih semua brand (ditegakkan juga oleh backend). Superadmin, Finance, dan Admin
 * tanpa brand sama sekali; Admin yang punya brand hanya memegang brand tugasnya (sama dengan scopedBrandId di API).
 */
export function isHoldingUser(user?: SessionUser | null) {
  if (!user) return false;
  if (user.role === 'superadmin' || user.role === 'finance') return true;
  return user.role === 'admin' && assignedBrandIds(user).length === 0;
}

/** Brand yang boleh dipilih user non-holding: brand utama + penugasan UserBrand. */
export function assignedBrandIds(user?: SessionUser | null) {
  const ids = new Set<number>();
  if (user?.brandId) ids.add(user.brandId);
  for (const ub of user?.userBrands ?? []) if (ub.brand?.id) ids.add(ub.brand.id);
  return [...ids];
}

export function canAccessBrand(user: SessionUser | null | undefined, brandId: number | null | undefined) {
  if (!user || !brandId) return false;
  return isHoldingUser(user) || assignedBrandIds(user).includes(brandId);
}

/**
 * Brand aktif untuk halaman operasional (Inbox, Pipeline, Paket). Semua role dengan akses
 * lebih dari satu brand dapat berpindah brand; pilihan yang tidak berhak diabaikan.
 */
export function useBrandScope() {
  const { user } = useAuth();
  const activeBrandId = useUiStore((state) => state.activeBrandId);
  const fallback = user?.brandId ?? assignedBrandIds(user)[0] ?? null;
  const brandId = canAccessBrand(user, activeBrandId) ? activeBrandId : (fallback ?? (isHoldingUser(user) ? activeBrandId : null));
  return { brandId, query: brandId ? `?brandId=${brandId}` : '' };
}

/**
 * Paket: Superadmin & Finance melihat semua brand; Admin hanya brand tugasnya (yang juga boleh ia kelola),
 * kecuali Admin tanpa penugasan sama sekali. Sama dengan aturan API /catalog/packages.
 */
export function packageBrandsUnrestricted(user?: SessionUser | null) {
  return isHoldingUser(user);
}
