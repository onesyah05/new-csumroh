import { capiEventForStatus, type ProspectStatus } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { buildCapiEventId, buildCapiPayload, validateEventValue, validateMetaConfig, type CapiEventName } from './capi.payload.js';
import { decryptMetaToken } from './meta-token.js';
import { dispatch, notifyCapiFailed } from '../notifications/notification.events.js';

/** Meta menolak event yang event_time-nya lebih tua dari 7 hari; beri sedikit ruang untuk jam server. */
export const CAPI_MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60_000 - 60 * 60_000;
/** Batas percobaan otomatis; setelah itu hanya tombol "Kirim ulang" di log. */
export const CAPI_MAX_ATTEMPTS = 8;

/**
 * Waktu kejadian bisnis yang immutable, bukan updatedAt yang berubah setiap edit profil. QualifiedLead (dan tahap yang
 * belum punya stempel waktu) memakai percobaan kirim pertama, yang terjadi tepat saat prospek mencapai tahap itu.
 */
function businessEventTime(
  prospect: { createdAt: Date; offerSentAt: Date | null; invoiceSentAt: Date | null; dpPaidAt: Date | null },
  eventName: CapiEventName,
  firstAttemptAt: Date | null,
) {
  if (eventName === 'LeadSubmitted') return prospect.createdAt;
  const at = eventName === 'Purchase' ? prospect.dpPaidAt
    : eventName === 'InitiateCheckout' ? prospect.invoiceSentAt
    : eventName === 'AddToCart' ? prospect.offerSentAt
    : null;
  return at ?? firstAttemptAt ?? new Date();
}

type DispatchResult = { status: 'sent' | 'failed' | 'skipped'; reason?: string; eventId?: string };
/** notify: false untuk retry/backfill otomatis agar satu konfigurasi yang salah tidak membanjiri notifikasi admin. */
type DispatchOptions = { notify?: boolean };

async function saveFailure(input: { brandId: number; prospectId: number; eventName: CapiEventName; eventId: string; reason: string; payload?: string; notify: boolean; attempts?: number }) {
  await prisma.metaCapiLog.upsert({
    where: { brandId_eventId: { brandId: input.brandId, eventId: input.eventId } },
    update: { status: 'failed', responseBody: input.reason, payload: input.payload, attempts: input.attempts ?? { increment: 1 } },
    create: { brandId: input.brandId, prospectId: input.prospectId, eventName: input.eventName, eventId: input.eventId, payload: input.payload, responseBody: input.reason, status: 'failed', attempts: input.attempts ?? 1 },
  });
  if (input.notify) dispatch(() => notifyCapiFailed(input.brandId, `${input.eventName}: ${input.reason}`));
  return { status: 'failed', reason: input.reason, eventId: input.eventId } as DispatchResult;
}

export async function dispatchCapiEvent(prospectId: number, eventName: CapiEventName, options: DispatchOptions = {}): Promise<DispatchResult> {
  const notify = options.notify ?? true;
  const prospect = await prisma.prospect.findUnique({
    where: { id: prospectId },
    include: { brand: true, package: true },
  });
  if (!prospect?.metaReferralMarker) return { status: 'skipped', reason: 'NO_CTWA_MARKER' };
  // Chat spam tidak pernah dikirim: Meta hanya belajar dari prospek yang serius.
  if (prospect.spamAt) return { status: 'skipped', reason: 'SPAM' };

  const eventId = buildCapiEventId(prospect.id, eventName, prospect.closedWonCount);
  const existing = await prisma.metaCapiLog.findUnique({ where: { brandId_eventId: { brandId: prospect.brandId, eventId } }, select: { status: true, createdAt: true } });
  if (existing?.status === 'success') return { status: 'skipped', reason: 'ALREADY_SENT', eventId };

  const eventTime = businessEventTime(prospect, eventName, existing?.createdAt ?? null);
  if (Date.now() - eventTime.getTime() > CAPI_MAX_EVENT_AGE_MS) {
    // Meta tidak lagi menerima event ini; log yang ada ditutup agar retry otomatis berhenti.
    if (existing) {
      await saveFailure({ brandId: prospect.brandId, prospectId, eventName, eventId, reason: 'Kejadian lebih dari 7 hari lalu; Meta tidak lagi menerima event ini.', notify: false, attempts: CAPI_MAX_ATTEMPTS });
    }
    return { status: 'skipped', reason: 'TOO_OLD', eventId };
  }

  const config = prospect.brand;
  const configResult = validateMetaConfig({ pixelId: config.metaPixelId, accessToken: config.metaAccessToken, pageId: config.facebookPageId });
  if (!configResult.valid) return saveFailure({ brandId: prospect.brandId, prospectId, eventName, eventId, reason: configResult.reason, notify });

  // Nilai hanya dari snapshot transaksi: dealValue = total booking (ditetapkan penawaran resmi /
  // verifikasi Finance), invoiceAmount = tagihan yang benar-benar diterbitkan. Tanpa fallback katalog.
  const effectiveDealValue = Number(prospect.dealValue) || 0;
  const effectiveInvoiceAmount = Number(prospect.invoiceAmount) || 0;

  const valueResult = validateEventValue(eventName, effectiveDealValue, effectiveInvoiceAmount);
  if (!valueResult.valid) return saveFailure({ brandId: prospect.brandId, prospectId, eventName, eventId, reason: valueResult.reason, notify });

  // Test Event Code tidak pernah ikut di event sungguhan: event bertanda uji tidak dipakai Meta untuk atribusi/optimasi.
  // Kode itu hanya untuk tombol "Uji Coba Event".
  const payload = buildCapiPayload({
    eventName,
    eventId,
    eventTime: Math.floor(eventTime.getTime() / 1000),
    phone: prospect.phone,
    ctwaClid: prospect.metaReferralMarker,
    pageId: config.facebookPageId!,
    whatsappBusinessAccountId: config.metaWabaId,
    name: prospect.name,
    city: prospect.city,
    value: valueResult.value,
  });
  const serializedPayload = JSON.stringify(payload);

  await prisma.metaCapiLog.upsert({
    where: { brandId_eventId: { brandId: prospect.brandId, eventId } },
    update: { status: 'pending', payload: serializedPayload, responseStatus: null, responseBody: null, attempts: { increment: 1 } },
    create: { brandId: prospect.brandId, prospectId, eventName, eventId, payload: serializedPayload, status: 'pending', attempts: 1 },
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
  if (status === 'failed' && notify) dispatch(() => notifyCapiFailed(prospect.brandId, `${eventName}: ${responseStatus ?? 'jaringan'} ${responseBody.slice(0, 120)}`));
  return { status: status === 'success' ? 'sent' : 'failed', ...(status === 'failed' ? { reason: responseBody } : {}), eventId };
}

/**
 * QualifiedLead = prospek terkualifikasi. Dikirim sekali saat pertama kali mencapai Terkualifikasi atau tahap sesudahnya
 * (event_id tetap, jadi tidak ganda), agar kampanye bisa dioptimalkan ke lead berkualitas, bukan sekadar chat masuk.
 */
const QUALIFIED_OR_LATER = new Set<string>(['qualified', 'offer', 'offered', 'objection', 'followup', 'closing', 'deal', 'closed_won']);

/** Event yang semestinya sudah terkirim untuk prospek di tahap ini (untuk backfill). */
export function expectedCapiEvents(status: string): CapiEventName[] {
  const events = new Set<CapiEventName>(['LeadSubmitted']);
  if (QUALIFIED_OR_LATER.has(status)) events.add('QualifiedLead');
  const stageEvent = capiEventForStatus(status as ProspectStatus);
  if (stageEvent) events.add(stageEvent as CapiEventName);
  return [...events];
}

export async function dispatchCapiForStatus(prospectId: number, status: ProspectStatus, options: DispatchOptions = {}) {
  if (QUALIFIED_OR_LATER.has(status)) await dispatchCapiEvent(prospectId, 'QualifiedLead', options);
  const eventName = capiEventForStatus(status);
  if (!eventName) return { status: 'skipped', reason: 'STATUS_HAS_NO_META_EVENT' } as DispatchResult;
  return dispatchCapiEvent(prospectId, eventName as CapiEventName, options);
}

export function queueCapiForStatus(prospectId: number, status: ProspectStatus, dispatch = dispatchCapiForStatus) {
  void dispatch(prospectId, status).catch((error) => console.error('CAPI dispatch failed', error));
}

/** Jeda sebelum percobaan berikutnya: 15 menit, lalu dua kali lipat (15m, 30m, 1j, 2j, … ±32 jam). */
export function capiRetryDelayMs(attempts: number) {
  return 15 * 60_000 * 2 ** Math.max(0, attempts - 1);
}

/** Batas kiriman ke Meta per putaran job, agar backfill besar tidak menahan scheduler. */
const SENDS_PER_RUN = 25;

/**
 * Kirim ulang event gagal (dan pending yang tertinggal karena proses mati) yang masih dalam jendela 7 hari Meta.
 * Tanpa notifikasi: kegagalan pertama sudah dilaporkan.
 */
export async function retryFailedCapiEvents(now = new Date()) {
  const logs = await prisma.metaCapiLog.findMany({
    where: {
      status: { in: ['failed', 'pending'] },
      attempts: { lt: CAPI_MAX_ATTEMPTS },
      createdAt: { gte: new Date(now.getTime() - CAPI_MAX_EVENT_AGE_MS) },
      eventId: { startsWith: 'csumroh_' },
    },
    select: { prospectId: true, eventName: true, attempts: true, updatedAt: true, status: true },
    orderBy: { updatedAt: 'asc' },
    take: 200,
  });
  let sent = 0;
  for (const log of logs) {
    if (sent >= SENDS_PER_RUN) break;
    // Pending lebih dari 10 menit = proses mati sebelum jawaban Meta tercatat.
    const wait = log.status === 'pending' ? 10 * 60_000 : capiRetryDelayMs(log.attempts);
    if (now.getTime() - log.updatedAt.getTime() < wait) continue;
    const result = await dispatchCapiEvent(log.prospectId, log.eventName as CapiEventName, { notify: false });
    if (result.status !== 'skipped') sent += 1;
  }
  return sent;
}

/**
 * Event yang belum pernah dikirim sama sekali: lead dari sinkron riwayat, lead sebelum CAPI diatur, atau tahap yang
 * berubah tanpa pemicu. Hanya prospek iklan yang berubah dalam 7 hari terakhir (batas Meta).
 */
export async function backfillCapiEvents(now = new Date()) {
  const prospects = await prisma.prospect.findMany({
    where: {
      metaReferralMarker: { not: null },
      spamAt: null,
      updatedAt: { gte: new Date(now.getTime() - CAPI_MAX_EVENT_AGE_MS) },
      brand: { metaPixelId: { not: null }, metaAccessToken: { not: null }, facebookPageId: { not: null } },
    },
    select: { id: true, status: true, createdAt: true, capiLogs: { select: { eventName: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 300,
  });
  const oldest = now.getTime() - CAPI_MAX_EVENT_AGE_MS;
  let sent = 0;
  for (const prospect of prospects) {
    if (sent >= SENDS_PER_RUN) break;
    const logged = new Set(prospect.capiLogs.map((log) => log.eventName));
    // LeadSubmitted memakai waktu chat pertama; lead yang lebih tua dari 7 hari tidak bisa dikirim lagi.
    const missing = expectedCapiEvents(prospect.status).filter((event) => !logged.has(event) && !(event === 'LeadSubmitted' && prospect.createdAt.getTime() < oldest));
    for (const event of missing) {
      const result = await dispatchCapiEvent(prospect.id, event, { notify: false });
      if (result.status !== 'skipped') sent += 1;
    }
  }
  return sent;
}

/**
 * Job terjadwal (tiap 5 menit): retry dulu, lalu backfill. Hanya di produksi: salinan database di laptop developer
 * menyimpan token Meta asli, dan backfill dari sana akan mengirim event ke dataset produksi.
 */
export async function capiSyncJob(now = new Date(), nodeEnv = env.NODE_ENV) {
  if (nodeEnv !== 'production' || now.getUTCMinutes() % 5 !== 0) return { retried: 0, backfilled: 0 };
  const retried = await retryFailedCapiEvents(now);
  const backfilled = await backfillCapiEvents(now);
  return { retried, backfilled };
}
