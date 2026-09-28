import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { authGuard, requireRole, scopedBrandId } from '../../middleware/auth.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { decryptMetaToken, encryptMetaToken, maskMetaToken } from './meta-token.js';
import { clearAdInsightsCache } from '../ads/ad-insights.js';
import { clearAdSpendCache } from '../reports/ad-spend.js';
import { adLabels } from '../ads/meta-ads.js';
import { buildCapiPayload, CAPI_EVENT_NAMES } from './capi.payload.js';

export const capiRouter = Router();
capiRouter.use(authGuard, requireRole('superadmin', 'admin'));

const metaId = z.string().trim().max(100).refine((value) => value === '' || /^\d+$/.test(value), 'ID Meta hanya boleh berisi angka.');
const settingsSchema = z.object({
  brandId: z.number().int().positive().optional(),
  pixelId: metaId,
  facebookPageId: metaId,
  whatsappBusinessAccountId: metaId,
  // Boleh ditempel dengan awalan act_ seperti di Ads Manager; disimpan angkanya saja.
  adAccountId: z.string().trim().max(60).transform((value) => value.replace(/^act_/i, '')).pipe(metaId).default(''),
  accessToken: z.string().trim().max(4096).optional(),
  clearAccessToken: z.boolean().optional(),
  // Token System User ber-izin ads_read untuk Laporan & audiens spam (opsional).
  adsAccessToken: z.string().trim().max(4096).optional(),
  clearAdsAccessToken: z.boolean().optional(),
  testEventCode: z.string().trim().max(100),
});

function settingsResponse(brand: {
  id: number;
  name: string;
  metaPixelId: string | null;
  metaAccessToken: string | null;
  metaAdsAccessToken: string | null;
  facebookPageId: string | null;
  metaWabaId: string | null;
  metaAdAccountId: string | null;
  metaTestEventCode: string | null;
  metaVerifiedAt: Date | null;
  metaLastError: string | null;
}) {
  const connectionConfigured = Boolean(brand.metaPixelId && brand.metaAccessToken);
  // WABA opsional (nomor WhatsApp Business biasa); Page ID wajib agar Meta bisa mencocokkan klik iklan.
  const ctwaReady = Boolean(connectionConfigured && brand.facebookPageId);
  return {
    brandId: brand.id,
    brandName: brand.name,
    pixelId: brand.metaPixelId ?? '',
    facebookPageId: brand.facebookPageId ?? '',
    whatsappBusinessAccountId: brand.metaWabaId ?? '',
    adAccountId: brand.metaAdAccountId ?? '',
    testEventCode: brand.metaTestEventCode ?? '',
    accessTokenConfigured: Boolean(brand.metaAccessToken),
    maskedAccessToken: maskMetaToken(brand.metaAccessToken),
    adsAccessTokenConfigured: Boolean(brand.metaAdsAccessToken),
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
  const current = await prisma.brand.findUnique({ where: { id: brandId }, select: { metaAccessToken: true, metaAdsAccessToken: true } });
  if (!current) throw new HttpError(404, 'Brand tidak ditemukan.');

  let metaAccessToken = current.metaAccessToken;
  if (input.clearAccessToken) metaAccessToken = null;
  else if (input.accessToken) metaAccessToken = encryptMetaToken(input.accessToken);
  let metaAdsAccessToken = current.metaAdsAccessToken;
  if (input.clearAdsAccessToken) metaAdsAccessToken = null;
  else if (input.adsAccessToken) metaAdsAccessToken = encryptMetaToken(input.adsAccessToken);

  const brand = await prisma.brand.update({
    where: { id: brandId },
    data: {
      metaPixelId: input.pixelId || null,
      facebookPageId: input.facebookPageId || null,
      metaWabaId: input.whatsappBusinessAccountId || null,
      metaAdAccountId: input.adAccountId || null,
      metaTestEventCode: input.testEventCode || null,
      metaAccessToken,
      metaAdsAccessToken,
      metaVerifiedAt: null,
      metaLastError: null,
    },
  });
  // Laporan iklan di-cache per ad account: token/ad account baru harus langsung terpakai.
  clearAdInsightsCache();
  clearAdSpendCache();
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
    res.json({ success: true, data: { connected: true, pixelId: graph.id ?? brand.metaPixelId, pixelName: graph.name ?? null, verifiedAt, ctwaReady: Boolean(brand.facebookPageId) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Koneksi ke Meta gagal.';
    await prisma.brand.update({ where: { id: brandId }, data: { metaVerifiedAt: null, metaLastError: message.slice(0, 5000) } });
    throw new HttpError(422, message, { responseStatus });
  }
}));

/** Log event per halaman; pencarian & filter di server agar event lama tetap bisa ditemukan. */
capiRouter.get('/logs', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const query = z.object({
    search: z.string().trim().max(100).default(''),
    event: z.enum(['all', ...CAPI_EVENT_NAMES]).default('all'),
    status: z.enum(['all', 'success', 'failed', 'pending']).default('all'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(10).max(100).default(25),
  }).parse(req.query);
  const digits = query.search.replace(/\D/g, '');
  const where: Prisma.MetaCapiLogWhereInput = {
    brandId,
    ...(query.event !== 'all' ? { eventName: query.event } : {}),
    ...(query.status !== 'all' ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { eventId: { contains: query.search } },
            { prospect: { name: { contains: query.search } } },
            ...(digits.length >= 4 ? [{ prospect: { phone: { contains: digits } } }] : []),
          ],
        }
      : {}),
  };
  const [total, grouped, items] = await Promise.all([
    prisma.metaCapiLog.count({ where }),
    // Ringkasan kartu "Event Audit Terkirim" dihitung dari seluruh log brand, bukan halaman ini saja.
    prisma.metaCapiLog.groupBy({ by: ['status'], where: { brandId }, _count: { _all: true } }),
    prisma.metaCapiLog.findMany({
      where,
      select: {
        id: true,
        eventName: true,
        eventId: true,
        status: true,
        responseStatus: true,
        responseBody: true,
        payload: true,
        createdAt: true,
        prospect: { select: { id: true, name: true, phone: true, adId: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  const ads = await adLabels(items.map((log) => log.prospect?.adId));
  const count = (status: string) => grouped.find((row) => row.status === status)?._count._all ?? 0;
  res.json({
    success: true,
    data: {
      items: items.map((log) => ({
        ...log,
        ad: log.prospect?.adId ? { adId: log.prospect.adId, adName: ads.get(log.prospect.adId)?.adName ?? null, campaignName: ads.get(log.prospect.adId)?.campaignName ?? null } : null,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      summary: { total: grouped.reduce((sum, row) => sum + row._count._all, 0), success: count('success'), failed: count('failed') },
    },
  });
}));

capiRouter.post('/test-event', asyncHandler(async (req, res) => {
  const input = z.object({
    brandId: z.number().int().positive().optional(),
    eventName: z.enum(CAPI_EVENT_NAMES).default('LeadSubmitted'),
    testEventCode: z.string().trim().max(100).optional(),
  }).parse(req.body);

  const brandId = scopedBrandId(req, input.brandId);
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) throw new HttpError(404, 'Brand tidak ditemukan.');
  if (!brand.metaPixelId || !brand.metaAccessToken || !brand.facebookPageId) {
    throw new HttpError(422, 'Simpan Pixel/Dataset ID, Facebook Page ID, dan access token terlebih dahulu.');
  }

  // Event uji wajib memakai test_event_code agar tidak tercatat sebagai konversi nyata.
  const effectiveTestCode = input.testEventCode || brand.metaTestEventCode || undefined;
  if (!effectiveTestCode) {
    throw new HttpError(422, 'Test Event Code wajib diisi (dari Events Manager > Test Events) sebelum mengirim event uji.');
  }
  // Meta menolak ctwa_clid karangan (subcode 2804087), jadi uji memakai klik iklan asli terakhir di brand ini.
  const source = await prisma.prospect.findFirst({
    where: { brandId, metaReferralMarker: { not: null }, phone: { not: null }, spamAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, phone: true, city: true, metaReferralMarker: true },
  });
  if (!source?.metaReferralMarker || !source.phone) {
    throw new HttpError(422, 'Belum ada chat dari iklan Click-to-WhatsApp di brand ini. Klik iklan Anda sekali dari HP lain dan kirim pesan, lalu ulangi uji coba.');
  }
  const eventId = `test_${Date.now()}_${input.eventName.toLowerCase()}`;
  const payload = buildCapiPayload({
    eventName: input.eventName,
    eventId,
    phone: source.phone,
    ctwaClid: source.metaReferralMarker,
    pageId: brand.facebookPageId,
    whatsappBusinessAccountId: brand.metaWabaId || undefined,
    name: source.name,
    city: source.city,
    value: input.eventName === 'Purchase' ? 25000000 : input.eventName === 'InitiateCheckout' ? 5000000 : undefined,
    testEventCode: effectiveTestCode,
  });
  const serializedPayload = JSON.stringify(payload);

  let responseStatus: number | undefined;
  let responseBody = '';
  let status: 'success' | 'failed' = 'failed';
  try {
    const token = decryptMetaToken(brand.metaAccessToken);
    const response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${encodeURIComponent(brand.metaPixelId)}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: serializedPayload,
      signal: AbortSignal.timeout(15_000),
    });
    responseStatus = response.status;
    responseBody = (await response.text()).slice(0, 10_000);
    status = response.ok ? 'success' : 'failed';
  } catch (error) {
    responseBody = error instanceof Error ? error.message : 'Network error';
  }

  res.json({
    // Permintaan uji tetap sukses walau Meta menolak: jawaban Meta (data.status/responseBody) ditampilkan di kotak hasil,
    // bukan dibuang menjadi pesan umum "Permintaan gagal".
    success: true,
    data: {
      eventId,
      status,
      responseStatus,
      responseBody,
      payload,
      testEventCode: effectiveTestCode ?? null,
      sourceProspect: { id: source.id, name: source.name },
    },
  });
}));
