import type { NextFunction, Request, Response } from 'express';

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
  console.error(error);
  res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server.' });
}
