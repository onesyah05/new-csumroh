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
  let session = await prisma.whatsappSession.findUnique({ where: { brandId: brand.id } });

  // Live Gateway Probe: verify if gateway is reachable and Baileys session is active
  let isGatewayAlive = false;
  let liveStatus: 'disconnected' | 'connecting' | 'connected' | 'qr_ready' | null = null;
  let livePhone: string | null = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const response = await fetch(`${env.WA_GATEWAY_URL}/sessions/${brand.id}/status`, {
      method: 'GET',
      headers: { 'x-internal-secret': env.WA_GATEWAY_SECRET },
      signal: controller.signal,
    }).catch(() => null);
    clearTimeout(timeout);

    if (response && response.ok) {
      isGatewayAlive = true;
      const body = (await response.json().catch(() => null)) as {
        data?: { status?: string; phoneNumber?: string };
      };
      const raw = body?.data?.status;
      if (raw === 'connected' || raw === 'connecting' || raw === 'qr_ready' || raw === 'disconnected') {
        liveStatus = raw;
      } else {
        liveStatus = 'disconnected';
      }
      const rawPhone = body?.data?.phoneNumber ?? null;
      livePhone = rawPhone ? rawPhone.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') || null : null;
    }
  } catch {
    isGatewayAlive = false;
  }

  // If gateway is down or unreachable, status cannot be connected or connecting
  if (!isGatewayAlive) {
    if (session && (session.status === 'connected' || session.status === 'connecting')) {
      session = await prisma.whatsappSession.update({
        where: { brandId: brand.id },
        data: { status: 'disconnected', qrCode: null },
      });
    }
  } else if (liveStatus && session && session.status !== liveStatus) {
    // Sync live gateway status to database
    session = await prisma.whatsappSession.update({
      where: { brandId: brand.id },
      data: {
        status: liveStatus,
        phoneNumber: livePhone || session.phoneNumber,
        qrCode: liveStatus === 'connected' ? null : session.qrCode,
      },
    });
  }

  // QR pairing hanya untuk pengelola perangkat; siapa pun yang memindainya dapat menautkan sesi WA brand.
  const canPairDevice = req.user!.role === 'superadmin' || req.user!.role === 'admin';
  res.json({
    success: true,
    data: session
      ? { ...session, qrCode: canPairDevice ? session.qrCode : null }
      : {
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
