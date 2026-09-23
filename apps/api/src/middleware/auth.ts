import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role, SessionUser } from '@csumroh/shared-types';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http.js';

type TokenPayload = SessionUser & { type: 'access'; iat: number; exp: number };

export function authGuard(req: Request, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Sesi tidak tersedia. Silakan login.'));
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as TokenPayload;
    if (payload.type !== 'access') throw new Error('Wrong token type');
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

export function scopedBrandId(req: Request, requestedBrandId?: number) {
  if (!req.user) throw new HttpError(401, 'Tidak terautentikasi.');

  // Roles with holding-wide authority can scope to any requested brand
  if (req.user.role === 'superadmin' || req.user.role === 'admin' || req.user.role === 'finance') {
    if (requestedBrandId) return requestedBrandId;
    if (req.user.brandId) return req.user.brandId;
    throw new HttpError(400, 'Brand wajib dipilih.');
  }

  // CS roles check both primary brandId and multi-brand userBrands assignments
  const allowedBrandIds = new Set<number>();
  if (req.user.brandId) allowedBrandIds.add(req.user.brandId);
  if (req.user.userBrands && Array.isArray(req.user.userBrands)) {
    for (const ub of req.user.userBrands) {
      if (ub.brand?.id) allowedBrandIds.add(ub.brand.id);
    }
  }

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
