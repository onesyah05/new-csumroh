import type { SessionUser } from '@csumroh/shared-types';
import { useAuth } from '../app/auth';
import { useUiStore } from '../app/store';

/** Role pengawas holding: boleh melihat & memilih semua brand (ditegakkan juga oleh backend). */
export function isHoldingRole(role?: string | null) {
  return role === 'superadmin' || role === 'admin' || role === 'finance';
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
  return isHoldingRole(user.role) || assignedBrandIds(user).includes(brandId);
}

/**
 * Brand aktif untuk halaman operasional (Inbox, Pipeline, Paket). Semua role dengan akses
 * lebih dari satu brand dapat berpindah brand; pilihan yang tidak berhak diabaikan.
 */
export function useBrandScope() {
  const { user } = useAuth();
  const activeBrandId = useUiStore((state) => state.activeBrandId);
  const fallback = user?.brandId ?? assignedBrandIds(user)[0] ?? null;
  const brandId = canAccessBrand(user, activeBrandId) ? activeBrandId : (fallback ?? (isHoldingRole(user?.role) ? activeBrandId : null));
  return { brandId, query: brandId ? `?brandId=${brandId}` : '' };
}
