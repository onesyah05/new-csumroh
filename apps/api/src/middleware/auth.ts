import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role, SessionUser } from '@csumroh/shared-types';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http.js';
import { isTokenRevoked } from '../modules/auth/sessions.js';

type TokenPayload = SessionUser & { type: 'access'; iat: number; exp: number };

export function authGuard(req: Request, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Sesi tidak tersedia. Silakan login.'));
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as TokenPayload;
    if (payload.type !== 'access') throw new Error('Wrong token type');
    if (isTokenRevoked(payload.id, payload.iat)) throw new Error('Revoked');
    req.user = {
      id: payload.id,
      name: payload.name,
      email: payload.email,
      role: payload.role,
      brandId: payload.brandId,
      brand: payload.brand,
      userBrands: payload.userBrands,
    };
    next();
  } catch {
    next(new HttpError(401, 'Sesi berakhir. Silakan login kembali.'));
  }
}

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) return next(new HttpError(403, 'Anda tidak memiliki akses ke fitur ini.'));
  next();
};

type BrandScopedUser = { role: string; brandId?: number | null; userBrands?: { brand?: { id: number } | null }[] | null };

/** Brand utama + penugasan UserBrand. */
export function assignedBrandIds(user: BrandScopedUser): number[] {
  const ids = new Set<number>();
  if (user.brandId) ids.add(user.brandId);
  if (Array.isArray(user.userBrands)) for (const ub of user.userBrands) if (ub.brand?.id) ids.add(ub.brand.id);
  return [...ids];
}

/**
 * Pengawas holding (semua brand): Superadmin, Finance, dan Admin yang tidak punya brand sama sekali. Admin yang punya
 * brand utama atau penugasan hanya memegang brand itu (aturan yang sama dengan penerima notifikasi dan pengelolaan paket).
 */
export function isHoldingWide(user: BrandScopedUser) {
  if (user.role === 'superadmin' || user.role === 'finance') return true;
  return user.role === 'admin' && assignedBrandIds(user).length === 0;
}

/** Brand yang boleh dilihat user; null = semua brand. Pakai untuk "semua brand" / tanpa brandId. */
export function visibleBrandIds(user: BrandScopedUser): number[] | null {
  return isHoldingWide(user) ? null : assignedBrandIds(user);
}

export function canAccessBrand(user: BrandScopedUser, brandId: number) {
  const visible = visibleBrandIds(user);
  return visible === null || visible.includes(brandId);
}

export function scopedBrandId(req: Request, requestedBrandId?: number) {
  if (!req.user) throw new HttpError(401, 'Tidak terautentikasi.');

  // Roles with holding-wide authority can scope to any requested brand
  if (isHoldingWide(req.user)) {
    if (requestedBrandId) return requestedBrandId;
    if (req.user.brandId) return req.user.brandId;
    throw new HttpError(400, 'Brand wajib dipilih.');
  }

  // Admin/CS lain: brand utama + penugasan UserBrand
  const allowedBrandIds = new Set<number>(assignedBrandIds(req.user));

  if (requestedBrandId) {
    if (!allowedBrandIds.has(requestedBrandId)) {
      throw new HttpError(403, 'Akses ke brand yang diminta tidak diizinkan.');
    }
    return requestedBrandId;
  }

  if (req.user.brandId) return req.user.brandId;
  if (allowedBrandIds.size > 0) return Array.from(allowedBrandIds)[0]!;

  throw new HttpError(403, 'Akun belum terhubung ke brand.');
}
