import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { authGuard, requireRole, scopedBrandId } from '../../middleware/auth.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { decryptMetaToken, encryptMetaToken, maskMetaToken } from './meta-token.js';
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
  testEventCode: z.string().trim().max(100),
});

function settingsResponse(brand: {
  id: number;
  name: string;
  metaPixelId: string | null;
  metaAccessToken: string | null;
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
      metaAdAccountId: input.adAccountId || null,
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
    res.json({ success: true, data: { connected: true, pixelId: graph.id ?? brand.metaPixelId, pixelName: graph.name ?? null, verifiedAt, ctwaReady: Boolean(brand.facebookPageId) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Koneksi ke Meta gagal.';
    await prisma.brand.update({ where: { id: brandId }, data: { metaVerifiedAt: null, metaLastError: message.slice(0, 5000) } });
    throw new HttpError(422, message, { responseStatus });
  }
}));

/**
 * Event CTWA harus dikirim ke dataset yang tertaut ke aset pengirim pesan (subcode 2804131). Tautan itu tidak bisa
 * dibuat dari Business Settings; Dataset API mengembalikan dataset milik WhatsApp Business Account (jalur resmi CTWA,
 * izin whatsapp_business_manage_events) atau milik Facebook Page (izin page_events), dan membuatnya bila belum ada.
 * Tidak menyimpan apa pun: Admin memutuskan sendiri apakah ID itu dipakai.
 */
async function requestOwnerDataset(ownerId: string, token: string) {
  try {
    const response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${encodeURIComponent(ownerId)}/dataset`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const text = (await response.text()).slice(0, 5000);
    const body = (() => { try { return JSON.parse(text) as { id?: string; error?: { message?: string; error_user_msg?: string } }; } catch { return {}; } })();
    if (response.status < 400 && body.id) return { datasetId: body.id };
    return { error: `${response.status}: ${body.error?.error_user_msg || body.error?.message || text || 'tanpa respons'}` };
  } catch (error) {
    return { error: `jaringan: ${error instanceof Error ? error.message : 'gagal'}` };
  }
}

capiRouter.post('/page-dataset', asyncHandler(async (req, res) => {
  const input = z.object({ brandId: z.number().int().positive().optional() }).parse(req.body);
  const brandId = scopedBrandId(req, input.brandId);
  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { facebookPageId: true, metaWabaId: true, metaAccessToken: true, metaPixelId: true } });
  if (!brand) throw new HttpError(404, 'Brand tidak ditemukan.');
  if (!brand.metaAccessToken || (!brand.metaWabaId && !brand.facebookPageId)) {
    throw new HttpError(422, 'Simpan access token serta WABA ID atau Facebook Page ID terlebih dahulu.');
  }
  const token = decryptMetaToken(brand.metaAccessToken);
  const owners = [
    ...(brand.metaWabaId ? [{ id: brand.metaWabaId, label: 'WhatsApp Business Account', permission: 'whatsapp_business_manage_events' }] : []),
    ...(brand.facebookPageId ? [{ id: brand.facebookPageId, label: 'Facebook Page', permission: 'page_events' }] : []),
  ];
  const failures: string[] = [];
  for (const owner of owners) {
    const result = await requestOwnerDataset(owner.id, token);
    if (result.datasetId) {
      res.json({ success: true, data: { datasetId: result.datasetId, owner: owner.label, currentDatasetId: brand.metaPixelId, same: result.datasetId === brand.metaPixelId } });
      return;
    }
    failures.push(`${owner.label} (butuh izin ${owner.permission}) ditolak ${result.error}`);
  }
  throw new HttpError(422, `Meta menolak: ${failures.join(' · ')}`);
}));

capiRouter.get('/logs', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const data = await prisma.metaCapiLog.findMany({
    where: { brandId },
    select: {
      id: true,
      eventName: true,
      eventId: true,
      status: true,
      responseStatus: true,
      responseBody: true,
      payload: true,
      createdAt: true,
      prospect: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ success: true, data });
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
