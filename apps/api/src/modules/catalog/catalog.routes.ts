import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../../db/prisma.js';
import { authGuard, requireRole, scopedBrandId } from '../../middleware/auth.js';
import { asyncHandler, HttpError } from '../../utils/http.js';

export const catalogRouter = Router();
catalogRouter.use(authGuard);

catalogRouter.get('/brands', asyncHandler(async (req, res) => {
  const rows = req.user!.role === 'superadmin'
    ? await prisma.brand.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { users: true, prospects: true, packages: true } }, whatsappSession: true } })
    : await prisma.brand.findMany({ where: { id: req.user!.brandId ?? -1 }, include: { _count: { select: { users: true, prospects: true, packages: true } }, whatsappSession: true } });
  const data = rows.map(({ metaAccessToken: _secret, metaLastError: _privateError, ...brand }) => brand);
  res.json({ success: true, data });
}));

catalogRouter.post('/brands', requireRole('superadmin'), asyncHandler(async (req, res) => {
  const input = z.object({ name: z.string().min(2).max(100), code: z.string().min(2).max(30).regex(/^[A-Z0-9_-]+$/), ppiuNumber: z.string().max(100).optional(), bankName: z.string().max(50).optional(), bankAccountNumber: z.string().max(50).optional(), bankAccountHolder: z.string().max(100).optional(), address: z.string().optional(), phone: z.string().max(30).optional() }).parse(req.body);
  const data = await prisma.brand.create({ data: input });
  res.status(201).json({ success: true, data });
}));

catalogRouter.get('/packages', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const data = await prisma.package.findMany({ where: { brandId }, orderBy: { departureDate: 'asc' } });
  res.json({ success: true, data });
}));

catalogRouter.post('/packages', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const schema = z.object({ brandId: z.number().int().positive().optional(), name: z.string().min(3).max(150), price: z.string().min(1).max(50), dp: z.string().min(1).max(50), priceQuad: z.string().max(50).optional(), priceTriple: z.string().max(50).optional(), priceDouble: z.string().max(50).optional(), priceInfant: z.string().max(50).optional(), quotaRemaining: z.number().int().nonnegative().optional(), departureDate: z.string().date().optional(), airline: z.string().max(100).optional(), hotelMakkah: z.string().max(100).optional(), hotelMadinah: z.string().max(100).optional(), duration: z.string().max(50).optional(), highlights: z.string().optional() });
  const input = schema.parse(req.body);
  const brandId = scopedBrandId(req, input.brandId);
  const data = await prisma.package.create({ data: { ...input, brandId, departureDate: input.departureDate ? new Date(input.departureDate) : undefined } });
  res.status(201).json({ success: true, data });
}));

catalogRouter.get('/users', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const brandId = req.user!.role === 'superadmin' ? (req.query.brandId ? Number(req.query.brandId) : undefined) : req.user!.brandId ?? undefined;
  const data = await prisma.user.findMany({ where: brandId ? { brandId } : {}, select: { id: true, name: true, email: true, role: true, brandId: true, isActive: true, createdAt: true, brand: { select: { name: true } } }, orderBy: { name: 'asc' } });
  res.json({ success: true, data });
}));

catalogRouter.post('/users', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const input = z.object({ brandId: z.number().int().positive().optional(), name: z.string().min(2).max(100), email: z.string().email(), password: z.string().min(8).max(128), role: z.enum(['admin', 'cs']).default('cs') }).parse(req.body);
  if (req.user!.role === 'admin' && input.role !== 'cs') throw new HttpError(403, 'Admin brand hanya dapat membuat akun CS.');
  const brandId = scopedBrandId(req, input.brandId);
  const password = await bcrypt.hash(input.password, 12);
  const data = await prisma.user.create({ data: { brandId, name: input.name, email: input.email.toLowerCase(), password, role: input.role }, select: { id: true, name: true, email: true, role: true, brandId: true, isActive: true } });
  res.status(201).json({ success: true, data });
}));

catalogRouter.patch('/users/:id/toggle', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
  if (!target) throw new HttpError(404, 'User tidak ditemukan.');
  if (req.user!.role === 'admin' && (target.brandId !== req.user!.brandId || target.role !== 'cs')) throw new HttpError(403, 'Admin hanya dapat mengelola CS pada brand sendiri.');
  const data = await prisma.user.update({ where: { id: target.id }, data: { isActive: !target.isActive }, select: { id: true, isActive: true } });
  res.json({ success: true, data });
}));
