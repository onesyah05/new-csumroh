import { Router } from 'express';
import { Prisma, ProspectStatus as DbProspectStatus } from '@prisma/client';
import { canTransitionStatus, prospectInputSchema, statusUpdateSchema, type ProspectStatus } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { authGuard, scopedBrandId } from '../../middleware/auth.js';
import { emitToBrand } from '../../realtime/socket.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { dispatchCapiForStatus } from '../capi/capi.service.js';

export const prospectsRouter = Router();
prospectsRouter.use(authGuard);

const include = { user: { select: { id: true, name: true } }, package: { select: { id: true, name: true, departureDate: true } } } as const;

prospectsRouter.get('/', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const search = String(req.query.search ?? '').trim();
  const status = req.query.status ? String(req.query.status) : undefined;
  const prospects = await prisma.prospect.findMany({
    where: { brandId, ...(status ? { status: status as DbProspectStatus } : {}), ...(search ? { OR: [{ name: { contains: search } }, { phone: { contains: search } }, { city: { contains: search } }] } : {}) },
    include,
    orderBy: { updatedAt: 'desc' },
  });
  res.json({ success: true, data: prospects });
}));

prospectsRouter.get('/:id', asyncHandler(async (req, res) => {
  const requestedBrand = req.user?.role === 'superadmin' && req.query.brandId ? Number(req.query.brandId) : undefined;
  const brandId = scopedBrandId(req, requestedBrand);
  const prospect = await prisma.prospect.findFirst({ where: { id: Number(req.params.id), brandId }, include: { ...include, brand: true, logs: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }, messages: { orderBy: { timestamp: 'asc' } } } });
  if (!prospect) throw new HttpError(404, 'Prospek tidak ditemukan.');
  res.json({ success: true, data: prospect });
}));

prospectsRouter.post('/', asyncHandler(async (req, res) => {
  const input = prospectInputSchema.parse(req.body);
  const brandId = scopedBrandId(req, req.body.brandId ? Number(req.body.brandId) : undefined);
  const prospect = await prisma.prospect.create({ data: { brandId, userId: req.user?.role === 'cs' ? req.user.id : null, name: input.name, phone: input.phone, city: input.city, leadSource: input.leadSource, packageId: input.packageId, notes: input.notes, nextFollowupDate: input.nextFollowupDate ? new Date(input.nextFollowupDate) : null }, include });
  await prisma.prospectLog.create({ data: { prospectId: prospect.id, userId: req.user!.id, actionType: 'created', title: 'Prospek dibuat' } });
  emitToBrand(brandId, 'prospect:updated', prospect);
  res.status(201).json({ success: true, data: prospect });
}));

prospectsRouter.patch('/:id/status', asyncHandler(async (req, res) => {
  const { status } = statusUpdateSchema.parse(req.body);
  const brandId = scopedBrandId(req, req.body.brandId ? Number(req.body.brandId) : undefined);
  const existing = await prisma.prospect.findFirst({ where: { id: Number(req.params.id), brandId } });
  if (!existing) throw new HttpError(404, 'Prospek tidak ditemukan.');
  if (!canTransitionStatus(existing.status as ProspectStatus, status)) throw new HttpError(422, `Transisi ${existing.status} → ${status} tidak diizinkan.`);
  const prospect = await prisma.$transaction(async (tx) => {
    const updated = await tx.prospect.update({ where: { id: existing.id }, data: { status: status as DbProspectStatus }, include });
    await tx.prospectLog.create({ data: { prospectId: existing.id, userId: req.user!.id, actionType: 'status_changed', title: `Status menjadi ${status}`, description: `Dari ${existing.status}` } });
    return updated;
  });
  emitToBrand(brandId, 'prospect:updated', prospect);
  void dispatchCapiForStatus(prospect.id, status).catch((error) => console.error('CAPI dispatch failed', error));
  res.json({ success: true, data: prospect });
}));

prospectsRouter.post('/:id/claim', asyncHandler(async (req, res) => {
  if (req.user!.role !== 'cs') throw new HttpError(403, 'Hanya CS yang dapat menjadi PIC.');
  const brandId = scopedBrandId(req);
  const result = await prisma.prospect.updateMany({ where: { id: Number(req.params.id), brandId, userId: null }, data: { userId: req.user!.id } });
  if (result.count === 0) throw new HttpError(409, 'Prospek sudah diklaim CS lain atau tidak ditemukan.');
  await prisma.prospectLog.create({ data: { prospectId: Number(req.params.id), userId: req.user!.id, actionType: 'pic_claimed', title: `PIC diklaim oleh ${req.user!.name}` } });
  const prospect = await prisma.prospect.findUniqueOrThrow({ where: { id: Number(req.params.id) }, include });
  emitToBrand(brandId, 'prospect:claimed', prospect);
  res.json({ success: true, data: prospect });
}));

prospectsRouter.patch('/:id/profile', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.body.brandId ? Number(req.body.brandId) : undefined);
  const id = Number(req.params.id);
  const allowed = ['targetMonth','budgetRange','roomPreference','paxQuad','paxTriple','paxDouble','paxInfant','specialNeeds','decisionMaker','passportStatus','vaccineStatus','dealValue','dpAmount','dpPaidAt','paymentStatus','lostReason','lostReasonDetail','notes','nextFollowupDate','packageId'] as const;
  const data = Object.fromEntries(allowed.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]])) as Prisma.ProspectUpdateInput;
  const updated = await prisma.prospect.updateMany({ where: { id, brandId }, data });
  if (!updated.count) throw new HttpError(404, 'Prospek tidak ditemukan.');
  await prisma.prospectLog.create({ data: { prospectId: id, userId: req.user!.id, actionType: 'profile_updated', title: 'Profil prospek diperbarui' } });
  const prospect = await prisma.prospect.findUniqueOrThrow({ where: { id }, include });
  emitToBrand(brandId, 'prospect:updated', prospect);
  res.json({ success: true, data: prospect });
}));
