import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { authGuard, requireRole, scopedBrandId } from '../../middleware/auth.js';
import { asyncHandler, HttpError } from '../../utils/http.js';

export const whatsappRouter = Router();
whatsappRouter.use(authGuard, requireRole('superadmin', 'admin'));

const brandIdSchema = z.coerce.number().int().positive();
const actionSchema = z.object({ brandId: brandIdSchema.optional() });

async function resolveBrand(req: Parameters<typeof scopedBrandId>[0], requestedBrandId?: unknown) {
  const parsedBrandId = requestedBrandId === undefined ? undefined : brandIdSchema.parse(requestedBrandId);
  const brandId = scopedBrandId(req, parsedBrandId);
  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true, name: true } });
  if (!brand) throw new HttpError(404, 'Brand tidak ditemukan.');
  return brand;
}

async function gatewayRequest(pathname: string, method: 'GET' | 'POST') {
  const response = await fetch(`${env.WA_GATEWAY_URL}${pathname}`, {
    method,
    headers: { 'x-internal-secret': env.WA_GATEWAY_SECRET },
  }).catch(() => null);
  if (!response) throw new HttpError(502, 'WhatsApp gateway tidak dapat dihubungi.');
  const body = await response.json().catch(() => null) as { success?: boolean; error?: string } | null;
  if (!response.ok || body?.success === false) throw new HttpError(502, body?.error ?? 'WhatsApp gateway menolak permintaan.');
  return body;
}

whatsappRouter.get('/status', asyncHandler(async (req, res) => {
  const brand = await resolveBrand(req, req.query.brandId);
  const session = await prisma.whatsappSession.findUnique({ where: { brandId: brand.id } });
  res.json({
    success: true,
    data: session ?? {
      brandId: brand.id,
      sessionName: `brand_${brand.id}`,
      status: 'disconnected',
      phoneNumber: null,
      qrCode: null,
      lastConnectedAt: null,
    },
  });
}));

whatsappRouter.post('/start', requireRole('superadmin'), asyncHandler(async (req, res) => {
  const input = actionSchema.parse(req.body ?? {});
  const brand = await resolveBrand(req, input.brandId);
  await prisma.whatsappSession.upsert({
    where: { brandId: brand.id },
    update: { status: 'connecting', qrCode: null },
    create: { brandId: brand.id, sessionName: `brand_${brand.id}`, status: 'connecting' },
  });
  try {
    await gatewayRequest(`/sessions/${brand.id}/start`, 'POST');
  } catch (error) {
    await prisma.whatsappSession.update({ where: { brandId: brand.id }, data: { status: 'disconnected', qrCode: null } });
    throw error;
  }
  const session = await prisma.whatsappSession.findUniqueOrThrow({ where: { brandId: brand.id } });
  res.json({ success: true, data: session });
}));

whatsappRouter.post('/disconnect', requireRole('superadmin'), asyncHandler(async (req, res) => {
  const input = actionSchema.parse(req.body ?? {});
  const brand = await resolveBrand(req, input.brandId);
  await gatewayRequest(`/sessions/${brand.id}/logout`, 'POST');
  const session = await prisma.whatsappSession.upsert({
    where: { brandId: brand.id },
    update: { status: 'disconnected', qrCode: null, phoneNumber: null },
    create: { brandId: brand.id, sessionName: `brand_${brand.id}`, status: 'disconnected' },
  });
  res.json({ success: true, data: session });
}));
