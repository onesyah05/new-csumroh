import { capiEventForStatus, type ProspectStatus } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { buildCapiEventId, buildCapiPayload, validateEventValue, validateMetaConfig, type CapiEventName } from './capi.payload.js';
import { decryptMetaToken } from './meta-token.js';

/** Waktu kejadian bisnis yang immutable, bukan updatedAt yang berubah setiap edit profil. */
function businessEventTime(
  prospect: { createdAt: Date; updatedAt: Date; offerSentAt: Date | null; invoiceSentAt: Date | null; dpPaidAt: Date | null },
  eventName: CapiEventName,
) {
  const at = eventName === 'Purchase' ? prospect.dpPaidAt
    : eventName === 'InitiateCheckout' ? prospect.invoiceSentAt
    : eventName === 'AddToCart' ? prospect.offerSentAt
    : null;
  return at ?? (eventName === 'Contact' ? prospect.createdAt : prospect.updatedAt);
}

type DispatchResult = { status: 'sent' | 'failed' | 'skipped'; reason?: string; eventId?: string };

async function saveFailure(input: { brandId: number; prospectId: number; eventName: CapiEventName; eventId: string; reason: string; payload?: string }) {
  await prisma.metaCapiLog.upsert({
    where: { brandId_eventId: { brandId: input.brandId, eventId: input.eventId } },
    update: { status: 'failed', responseBody: input.reason, payload: input.payload },
    create: { brandId: input.brandId, prospectId: input.prospectId, eventName: input.eventName, eventId: input.eventId, payload: input.payload, responseBody: input.reason, status: 'failed' },
  });
  return { status: 'failed', reason: input.reason, eventId: input.eventId } as DispatchResult;
}

export async function dispatchCapiEvent(prospectId: number, eventName: CapiEventName): Promise<DispatchResult> {
  const prospect = await prisma.prospect.findUnique({
    where: { id: prospectId },
    include: { brand: true, package: true },
  });
  if (!prospect?.metaReferralMarker) return { status: 'skipped', reason: 'NO_CTWA_MARKER' };

  const eventId = buildCapiEventId(prospect.id, eventName, prospect.closedWonCount);
  const successful = await prisma.metaCapiLog.findUnique({ where: { brandId_eventId: { brandId: prospect.brandId, eventId } }, select: { status: true } });
  if (successful?.status === 'success') return { status: 'skipped', reason: 'ALREADY_SENT', eventId };

  const config = prospect.brand;
  if (!prospect.phone) return saveFailure({ brandId: prospect.brandId, prospectId, eventName, eventId, reason: 'Nomor telepon prospek belum tersedia.' });
  const configResult = validateMetaConfig({ pixelId: config.metaPixelId, accessToken: config.metaAccessToken, pageId: config.facebookPageId, wabaId: config.metaWabaId });
  if (!configResult.valid) return saveFailure({ brandId: prospect.brandId, prospectId, eventName, eventId, reason: configResult.reason });

  // Nilai hanya dari snapshot transaksi: dealValue = total booking (ditetapkan penawaran resmi /
  // verifikasi Finance), invoiceAmount = tagihan yang benar-benar diterbitkan. Tanpa fallback katalog.
  const effectiveDealValue = Number(prospect.dealValue) || 0;
  const effectiveInvoiceAmount = Number(prospect.invoiceAmount) || 0;

  const valueResult = validateEventValue(eventName, effectiveDealValue, effectiveInvoiceAmount);
  if (!valueResult.valid) return saveFailure({ brandId: prospect.brandId, prospectId, eventName, eventId, reason: valueResult.reason });

  const payload = buildCapiPayload({
    eventName,
    eventId,
    eventTime: Math.floor(businessEventTime(prospect, eventName).getTime() / 1000),
    phone: prospect.phone,
    ctwaClid: prospect.metaReferralMarker,
    pageId: config.facebookPageId!,
    whatsappBusinessAccountId: config.metaWabaId,
    value: valueResult.value,
    testEventCode: config.metaTestEventCode,
  });
  const serializedPayload = JSON.stringify(payload);

  await prisma.metaCapiLog.upsert({
    where: { brandId_eventId: { brandId: prospect.brandId, eventId } },
    update: { status: 'pending', payload: serializedPayload, responseStatus: null, responseBody: null },
    create: { brandId: prospect.brandId, prospectId, eventName, eventId, payload: serializedPayload, status: 'pending' },
  });

  let responseStatus: number | undefined;
  let responseBody = '';
  let status: 'success' | 'failed' = 'failed';
  try {
    const token = decryptMetaToken(config.metaAccessToken!);
    const response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${encodeURIComponent(config.metaPixelId!)}/events`, {
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

  await prisma.metaCapiLog.update({ where: { brandId_eventId: { brandId: prospect.brandId, eventId } }, data: { responseStatus, responseBody, status } });
  return { status: status === 'success' ? 'sent' : 'failed', ...(status === 'failed' ? { reason: responseBody } : {}), eventId };
}

export async function dispatchCapiForStatus(prospectId: number, status: ProspectStatus) {
  const eventName = capiEventForStatus(status);
  if (!eventName) return { status: 'skipped', reason: 'STATUS_HAS_NO_META_EVENT' } as DispatchResult;
  return dispatchCapiEvent(prospectId, eventName as CapiEventName);
}

export function queueCapiForStatus(prospectId: number, status: ProspectStatus, dispatch = dispatchCapiForStatus) {
  void dispatch(prospectId, status).catch((error) => console.error('CAPI dispatch failed', error));
}
