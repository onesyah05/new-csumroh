import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { authGuard, requireRole, scopedBrandId } from '../../middleware/auth.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { decryptMetaToken, encryptMetaToken, maskMetaToken } from './meta-token.js';

export const capiRouter = Router();
capiRouter.use(authGuard, requireRole('superadmin', 'admin'));

const metaId = z.string().trim().max(100).refine((value) => value === '' || /^\d+$/.test(value), 'ID Meta hanya boleh berisi angka.');
const settingsSchema = z.object({
  brandId: z.number().int().positive().optional(),
  pixelId: metaId,
  facebookPageId: metaId,
  whatsappBusinessAccountId: metaId,
  accessToken: z.string().trim().max(4096).optional(),
  clearAccessToken: z.boolean().optional(),
  testEventCode: z.string().trim().max(100),
});

function settingsResponse(brand: {
  id: number;
  name: string;
  metaPixelId: string | null;
  metaAccessToken: string | null;
  facebookPageId: string | null;
  metaWabaId: string | null;
  metaTestEventCode: string | null;
  metaVerifiedAt: Date | null;
  metaLastError: string | null;
}) {
  const connectionConfigured = Boolean(brand.metaPixelId && brand.metaAccessToken);
  const ctwaReady = Boolean(connectionConfigured && brand.facebookPageId && brand.metaWabaId);
  return {
    brandId: brand.id,
    brandName: brand.name,
    pixelId: brand.metaPixelId ?? '',
    facebookPageId: brand.facebookPageId ?? '',
    whatsappBusinessAccountId: brand.metaWabaId ?? '',
    testEventCode: brand.metaTestEventCode ?? '',
    accessTokenConfigured: Boolean(brand.metaAccessToken),
    maskedAccessToken: maskMetaToken(brand.metaAccessToken),
    connectionConfigured,
    ctwaReady,
    verifiedAt: brand.metaVerifiedAt,
    lastError: brand.metaLastError,
  };
}

capiRouter.get('/settings', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) throw new HttpError(404, 'Brand tidak ditemukan.');
  res.json({ success: true, data: settingsResponse(brand) });
}));

capiRouter.put('/settings', asyncHandler(async (req, res) => {
  const input = settingsSchema.parse(req.body);
  const brandId = scopedBrandId(req, input.brandId);
  const current = await prisma.brand.findUnique({ where: { id: brandId }, select: { metaAccessToken: true } });
  if (!current) throw new HttpError(404, 'Brand tidak ditemukan.');

  let metaAccessToken = current.metaAccessToken;
  if (input.clearAccessToken) metaAccessToken = null;
  else if (input.accessToken) metaAccessToken = encryptMetaToken(input.accessToken);

  const brand = await prisma.brand.update({
    where: { id: brandId },
    data: {
      metaPixelId: input.pixelId || null,
      facebookPageId: input.facebookPageId || null,
      metaWabaId: input.whatsappBusinessAccountId || null,
      metaTestEventCode: input.testEventCode || null,
      metaAccessToken,
      metaVerifiedAt: null,
      metaLastError: null,
    },
  });
  res.json({ success: true, data: settingsResponse(brand) });
}));

capiRouter.post('/verify', asyncHandler(async (req, res) => {
  const input = z.object({ brandId: z.number().int().positive().optional() }).parse(req.body);
  const brandId = scopedBrandId(req, input.brandId);
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) throw new HttpError(404, 'Brand tidak ditemukan.');
  if (!brand.metaPixelId || !brand.metaAccessToken) throw new HttpError(422, 'Simpan Pixel/Dataset ID dan access token terlebih dahulu.');

  let responseStatus: number | undefined;
  let responseText = '';
  try {
    const token = decryptMetaToken(brand.metaAccessToken);
    const response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${encodeURIComponent(brand.metaPixelId)}?fields=id,name`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    responseStatus = response.status;
    responseText = (await response.text()).slice(0, 5000);
    if (!response.ok) throw new Error(`Meta Graph API menolak koneksi (${response.status}): ${responseText}`);
    const graph = JSON.parse(responseText) as { id?: string; name?: string };
    const verifiedAt = new Date();
    await prisma.brand.update({ where: { id: brandId }, data: { metaVerifiedAt: verifiedAt, metaLastError: null } });
    res.json({ success: true, data: { connected: true, pixelId: graph.id ?? brand.metaPixelId, pixelName: graph.name ?? null, verifiedAt, ctwaReady: Boolean(brand.facebookPageId && brand.metaWabaId) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Koneksi ke Meta gagal.';
    await prisma.brand.update({ where: { id: brandId }, data: { metaVerifiedAt: null, metaLastError: message.slice(0, 5000) } });
    throw new HttpError(422, message, { responseStatus });
  }
}));

capiRouter.get('/logs', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const data = await prisma.metaCapiLog.findMany({
    where: { brandId },
    select: { id: true, eventName: true, eventId: true, status: true, responseStatus: true, responseBody: true, createdAt: true, prospect: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json({ success: true, data });
}));
