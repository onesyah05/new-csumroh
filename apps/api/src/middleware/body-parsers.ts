import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http.js';
import { secretMatches } from '../utils/secrets.js';
import { authGuard } from './auth.js';

/**
 * Batas body: kecil secara bawaan. Body besar (media/flyer/logo/bukti berbentuk base64) hanya diterima pada
 * rute unggahan dan SETELAH token diverifikasi; body internal gateway (hingga 10 MB) hanya setelah secret cocok.
 * Dengan begitu request anonim tidak bisa memaksa server mem-parse puluhan MB (DoS).
 */
const LARGE_BODY_ROUTES = [
  /^\/api\/v1\/chat\/messages\/media$/,
  /^\/api\/v1\/gallery\/assets$/,
  /^\/api\/v1\/catalog\/brands\/upload-logo$/,
  /^\/api\/v1\/catalog\/packages\/upload-flyer$/,
  /^\/api\/v1\/catalog\/packages\/\d+\/flyer$/,
  /^\/api\/v1\/catalog\/brands\/\d+\/itinerary-template$/,
  /^\/api\/v1\/prospects\/\d+\/payment-proof(?:-upload)?$/,
];
const smallJson = express.json({ limit: '1mb' });
const internalJson = express.json({ limit: '10mb' });
const largeJson = express.json({ limit: '50mb' });

export function bodyParsers(req: Request, res: Response, next: NextFunction) {
  if (LARGE_BODY_ROUTES.some((route) => route.test(req.path))) {
    return authGuard(req, res, (error?: unknown) => (error ? next(error) : largeJson(req, res, next)));
  }
  if (req.path.startsWith('/internal/')) {
    // Secret dulu, baru body: permintaan tanpa secret ditolak sebelum JSON apa pun diparse.
    if (!secretMatches(req.get('x-internal-secret'), env.WA_GATEWAY_SECRET)) return next(new HttpError(401, 'Internal secret tidak valid.'));
    return internalJson(req, res, next);
  }
  return smallJson(req, res, next);
}
