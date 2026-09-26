import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

export const asyncHandler = (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => void handler(req, res, next).catch(next);

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    res.status(error.status).json({ success: false, error: error.message, details: error.details });
    return;
  }

  if (error instanceof ZodError) {
    const message = error.issues.map((issue) => {
      const field = issue.path.join('.');
      return field ? `${field}: ${issue.message}` : issue.message;
    }).join(', ');
    res.status(422).json({
      success: false,
      error: message || 'Data input tidak valid.',
      details: error.issues,
    });
    return;
  }

  // Prisma Unique Constraint Violation (P2002)
  if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
    const target = (error as { meta?: { target?: string[] | string } }).meta?.target;
    let message = 'Data yang dimasukkan sudah digunakan oleh data lain.';
    if (typeof target === 'string' || Array.isArray(target)) {
      const targetStr = Array.isArray(target) ? target.join(', ') : target;
      if (targetStr.includes('code')) {
        message = 'Kode brand sudah digunakan. Silakan gunakan kode lain.';
      } else if (targetStr.includes('email')) {
        message = 'Email sudah terdaftar. Silakan gunakan email lain.';
      } else if (targetStr.includes('brand_id')) {
        message = 'Data untuk brand ini sudah ada.';
      }
    }
    res.status(409).json({ success: false, error: message });
    return;
  }

  // Error body-parser (body terlalu besar / JSON rusak): status 4xx dari library, tanpa detail internal.
  const parserError = error as { type?: string; status?: number };
  if (parserError?.type === 'entity.too.large') {
    res.status(413).json({ success: false, error: 'Ukuran data terlalu besar.' });
    return;
  }
  if (parserError?.type === 'entity.parse.failed') {
    res.status(400).json({ success: false, error: 'Format data tidak valid.' });
    return;
  }

  console.error(error);
  res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server.' });
}

