import { randomUUID } from 'node:crypto';
import { secretMatches } from '../../utils/secrets.js';
import { ensureConversationStats, loadConversationWindows, scheduleConversationStats, summarizeMessages } from './conversation-stats.js';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { messageInputSchema } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { authGuard, scopedBrandId } from '../../middleware/auth.js';
import { emitToBrand } from '../../realtime/socket.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { dispatchCapiEvent, queueCapiForStatus } from '../capi/capi.service.js';
import { attachReferralMarker, normalizeReferralMarker } from '../prospects/referral.service.js';
import { gatewayFailure, normalizePhoneIdentifier, prospectChatJid, sendingDevicePhone, sendTextToProspect } from './outbound.js';
import { activeDevicePhone, adoptUnassignedProspects } from './device-scope.js';
import { adLabels } from '../ads/meta-ads.js';
import { syncSessionWithGateway } from '../whatsapp/gateway-probe.js';
import { resolveFlyerFile, safeChatMediaExtension } from '../../utils/safe-path.js';
import { Prisma, type ChatMessage } from '@prisma/client';
import { avatarNeedsRefresh } from '@csumroh/shared-types';
import { refreshProspectAvatar, refreshProspectAvatars } from './avatar.service.js';
import { pickAutoAssignee } from '../prospects/pic.js';
import { resolveNotifications } from '../notifications/notify.service.js';
import {
  dispatch,
  notifyInboundMessage,
  notifyLeadAssigned,
  notifyPicChange,
  onWhatsappStatus,
  resolveReplyNotifications,
} from '../notifications/notification.events.js';

export const chatRouter = Router();
chatRouter.use(authGuard);

/** Batas "hapus untuk semua" di WhatsApp (±2 hari); lewat dari itu jamaah tetap melihat pesannya. */
const DELETE_FOR_EVERYONE_SECONDS = 2 * 24 * 60 * 60;
const STATUS_PROBE_MS = 15_000;
const statusProbedAt = new Map<number, number>();

type ProspectIdentity = {
  id: number;
  name: string;
  phone: string | null;
  remoteJid: string | null;
  packageId?: number | null;
  userId?: number | null;
  notes?: string | null;
  updatedAt?: Date;
  messages?: Array<{ timestamp: number }>;
};

export { normalizePhoneIdentifier };

export function phoneAliases(value?: string | null) {
  const normalized = normalizePhoneIdentifier(value);
  if (!normalized) return [];
  return [...new Set([
    normalized,
    `+${normalized}`,
    normalized.startsWith('62') ? `0${normalized.slice(2)}` : normalized,
  ])];
}

export function isGenericContactName(name?: string | null, phone?: string | null): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed || trimmed === 'Kontak WhatsApp' || trimmed === 'Grup WhatsApp') return true;
  if (trimmed.includes('@lid') || trimmed.includes('@s.whatsapp.net')) return true;
  const digitsOnly = trimmed.replace(/[\s\-\(\)\+\.]/g, '');
  if (/^\d+$/.test(digitsOnly) && digitsOnly.length >= 8) return true;
  if (phone && normalizePhoneIdentifier(trimmed) === normalizePhoneIdentifier(phone)) return true;
  return false;
}

/**
 * Peta @lid ↔ nomor dibangun dari seluruh pesan & prospek brand (pemindaian LIKE '%@lid'). Hasilnya di-cache
 * 30 detik per brand dan dikosongkan saat pesan/kontak membawa pasangan @lid↔nomor baru (invalidateLidPhoneMap).
 */
const lidMapCache = new Map<number, { at: number; ownKey: string; value: { lidToPhone: Map<string, string>; phoneToLid: Map<string, string> } }>();
const LID_MAP_TTL_MS = 30_000;
export function invalidateLidPhoneMap(brandId: number) {
  lidMapCache.delete(brandId);
}

export async function buildLidPhoneMap(brandId: number, ownPhones: Set<string>) {
  const ownKey = [...ownPhones].sort().join(',');
  const cached = lidMapCache.get(brandId);
  if (cached && cached.ownKey === ownKey && Date.now() - cached.at < LID_MAP_TTL_MS) return cached.value;
  const value = await computeLidPhoneMap(brandId, ownPhones);
  lidMapCache.set(brandId, { at: Date.now(), ownKey, value });
  return value;
}

async function computeLidPhoneMap(brandId: number, ownPhones: Set<string>) {
  const lidToPhone = new Map<string, string>();
  const phoneToLid = new Map<string, string>();

  const msgsWithBoth = await prisma.chatMessage.findMany({
    where: {
      brandId,
      remoteJid: { endsWith: '@lid' },
      phone: { not: '' },
    },
    select: { remoteJid: true, phone: true },
  });
  for (const m of msgsWithBoth) {
    const pn = normalizePhoneIdentifier(m.phone);
    if (pn && !ownPhones.has(pn)) {
      lidToPhone.set(m.remoteJid, pn);
      phoneToLid.set(pn, m.remoteJid);
    }
  }

  const prospectsWithBoth = await prisma.prospect.findMany({
    where: {
      brandId,
      remoteJid: { endsWith: '@lid' },
      phone: { not: null },
    },
    select: { remoteJid: true, phone: true },
  });
  for (const p of prospectsWithBoth) {
    const pn = normalizePhoneIdentifier(p.phone);
    if (pn && p.remoteJid && !ownPhones.has(pn)) {
      lidToPhone.set(p.remoteJid, pn);
      phoneToLid.set(pn, p.remoteJid);
    }
  }

  return { lidToPhone, phoneToLid };
}

export function conversationKey(
  prospect: ProspectIdentity,
  lidToPhone?: Map<string, string>,
  ownPhones?: Set<string>,
) {
  if (prospect.remoteJid && prospect.remoteJid.endsWith('@g.us')) {
    return `group:${prospect.remoteJid}`;
  }
  const pn = normalizePhoneIdentifier(prospect.phone)
    || (prospect.remoteJid && lidToPhone ? lidToPhone.get(prospect.remoteJid) : '')
    || normalizePhoneIdentifier(prospect.remoteJid);
  if (pn && (!ownPhones || !ownPhones.has(pn))) return `phone:${pn}`;
  if (prospect.remoteJid) return `jid:${prospect.remoteJid}`;
  return `id:${prospect.id}`;
}

export function prospectScore(prospect: ProspectIdentity) {
  if (prospect.remoteJid && prospect.remoteJid.endsWith('@g.us')) return 1000;
  const genericName = isGenericContactName(prospect.name, prospect.phone);
  return (genericName ? 0 : 100)
    + (prospect.phone ? 50 : 0)
    + (prospect.packageId ? 20 : 0)
    + (prospect.userId ? 10 : 0)
    + (prospect.notes ? 5 : 0)
    + (prospect.messages?.[0]?.timestamp ?? 0) / 1_000_000_000;
}

export function chooseCanonicalProspect<T extends ProspectIdentity>(prospects: T[]) {
  return [...prospects].sort((a, b) => prospectScore(b) - prospectScore(a))[0]!;
}

/** Field pesan terakhir untuk daftar percakapan/Pipeline; teks dipotong untuk pratinjau & pencarian. */
function messagePreview(message: ChatMessage) {
  return {
    id: message.id, messageId: message.messageId, prospectId: message.prospectId, remoteJid: message.remoteJid,
    isFromMe: message.isFromMe, messageText: message.messageText?.slice(0, 300) ?? null, messageType: message.messageType,
    mediaUrl: message.mediaUrl, status: message.status, timestamp: message.timestamp, senderName: message.senderName,
  };
}

export async function getLivechatConversationsForBrand(brandId: number) {
  const session = await prisma.whatsappSession.findUnique({ where: { brandId } });
  // Kontak hanya tampil selama device asalnya tersambung (lihat device-scope.ts).
  const devicePhone = session?.status === 'connected' ? normalizePhoneIdentifier(session.phoneNumber) : '';
  if (!devicePhone) {
    return [];
  }
  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { id: true, name: true, code: true, phone: true },
  });
  const ownPhones = new Set([
    normalizePhoneIdentifier(session?.phoneNumber),
    normalizePhoneIdentifier(brand?.phone),
  ].filter(Boolean));

  const { lidToPhone } = await buildLidPhoneMap(brandId, ownPhones);

  // Ringkasan percakapan dibaca dari tabel prospek (lihat conversation-stats.ts); prospek lama/impor yang belum
  // punya ringkasan dihitung dulu. Prospek tanpa pesan tampil (lastMessageAt null) tidak masuk daftar.
  await ensureConversationStats(brandId);
  const prospects = await prisma.prospect.findMany({
    where: {
      brandId,
      devicePhone,
      lastMessageAt: { not: null },
      NOT: [
        { remoteJid: { contains: '@newsletter' } },
        { remoteJid: { contains: '@broadcast' } },
      ],
    },
    include: {
      user: { select: { id: true, name: true } },
      package: { select: { id: true, name: true, departureDate: true } },
      // Status layanan custom yang berjalan (label di daftar percakapan & Pipeline).
      customRequests: { where: { status: { not: 'cancelled' } }, orderBy: { id: 'desc' }, take: 1, select: { id: true, status: true, quoteValidUntil: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  // Nama iklan asal untuk badge "Meta Ads" (dari tabel tersimpan saja: daftar tidak boleh menunggu Meta).
  const ads = await adLabels(prospects.map((prospect) => prospect.adId));
  const grouped = new Map<string, typeof prospects>();
  for (const prospect of prospects) {
    if (prospect.remoteJid && prospect.remoteJid.endsWith('@g.us')) {
      const key = `group:${prospect.remoteJid}`;
      grouped.set(key, [...(grouped.get(key) ?? []), prospect]);
      continue;
    }

    const pn = normalizePhoneIdentifier(prospect.phone) || (prospect.remoteJid ? lidToPhone.get(prospect.remoteJid) : '');
    const isOwn = (pn && ownPhones.has(pn)) || (prospect.remoteJid && ownPhones.has(normalizePhoneIdentifier(prospect.remoteJid)));
    const key = isOwn ? `self:${pn || 'own'}` : conversationKey(prospect, lidToPhone, ownPhones);
    grouped.set(key, [...(grouped.get(key) ?? []), prospect]);
  }

  const data = (await Promise.all([...grouped.values()].map(async (group) => {
    const { lastMessage: _last, inboundSenderName: _sender, conversationStatsAt: _statsAt, ...canonical } = chooseCanonicalProspect(group);
    const summary = group.length === 1
      ? {
          latest: group[0]!.lastMessage as unknown as (ChatMessage | null),
          unreadCount: group[0]!.unreadCount,
          awaitingSince: group[0]!.awaitingSince,
          inboundSenderName: group[0]!.inboundSenderName,
        }
      : summarizeMessages(await loadConversationWindows(group.map((item) => item.id)));
    const latest = summary.latest;
    const isGroup = Boolean(canonical.remoteJid && canonical.remoteJid.endsWith('@g.us'));
    const resolvedPhone = isGroup ? null : (normalizePhoneIdentifier(canonical.phone) || (canonical.remoteJid ? lidToPhone.get(canonical.remoteJid) : null));
    const pn = normalizePhoneIdentifier(canonical.phone) || (canonical.remoteJid ? lidToPhone.get(canonical.remoteJid) : '');
    const isOwn = (pn && ownPhones.has(pn)) || (canonical.remoteJid && ownPhones.has(normalizePhoneIdentifier(canonical.remoteJid)));

    const unreadCount = summary.unreadCount;
    const awaitingSince = isGroup ? null : summary.awaitingSince;

    let displayName = canonical.name;
    if (canonical.remoteJid === '0@s.whatsapp.net') {
      displayName = 'WhatsApp';
    } else if (isOwn) {
      displayName = canonical.name && canonical.name.includes('(Anda)')
        ? canonical.name
        : `+${resolvedPhone || canonical.phone || session?.phoneNumber || brand?.phone} (Anda)`;
    } else if (isGroup) {
      displayName = canonical.name && canonical.name !== canonical.remoteJid ? canonical.name : 'Grup WhatsApp';
    } else {
      const nameIsGeneric = isGenericContactName(displayName, resolvedPhone || canonical.phone);
      if (summary.inboundSenderName && nameIsGeneric) {
        displayName = summary.inboundSenderName;
      } else if (nameIsGeneric) {
        displayName = resolvedPhone ? `+${resolvedPhone}` : (canonical.phone ? `+${canonical.phone}` : 'Kontak WhatsApp');
      }
    }

    const totalMessageCount = group.reduce((sum, item) => sum + item.messageCount, 0);

    return {
      ...canonical,
      name: displayName,
      phone: resolvedPhone || canonical.phone,
      isGroup,
      isOwn,
      unreadCount,
      awaitingSince,
      messageCount: totalMessageCount,
      // Pratinjau baris: hanya field yang dipakai daftar (bukan seluruh kolom pesan).
      messages: latest ? [messagePreview(latest)] : [],
      duplicateIds: group.map((item) => item.id),
      adName: canonical.adId ? ads.get(canonical.adId)?.adName ?? null : null,
      adCampaignName: canonical.adId ? ads.get(canonical.adId)?.campaignName ?? null : null,
      brand: brand!,
      // Ringkas: tanpa qrCode (QR penautan perangkat tidak boleh sampai ke CS) dan kolom lain yang tidak dipakai.
      session: session ? { status: session.status, phoneNumber: session.phoneNumber, sessionName: session.sessionName } : null,
    };
  }))).filter((item) => {
    const m = item.messages[0];
    return m && (Boolean(m.messageText?.trim()) || Boolean(m.mediaUrl) || ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].includes(m.messageType));
  })
    .sort((a, b) => (b.messages[0]?.timestamp ?? 0) - (a.messages[0]?.timestamp ?? 0));

  return data;
}

chatRouter.get('/conversations', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const data = await getLivechatConversationsForBrand(brandId);

  // Salin foto profil WhatsApp yang belum ada / basi ke server di latar belakang (URL CDN WA kedaluwarsa).
  const missing = data.filter((item) => avatarNeedsRefresh(item.photoUrl) && !item.isGroup && item.remoteJid !== '0@s.whatsapp.net');
  if (missing.length > 0) {
    setImmediate(() => {
      void refreshProspectAvatars(missing.slice(0, 10).map((item) => ({
        id: item.id, brandId, remoteJid: item.remoteJid, phone: item.phone, photoUrl: item.photoUrl,
      })));
    });
  }

  res.json({ success: true, data });
}));

chatRouter.get('/prospects/:id/avatar', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const prospectId = Number(req.params.id);
  const prospect = await prisma.prospect.findFirst({
    where: { id: prospectId, brandId },
    select: { id: true, photoUrl: true, remoteJid: true, phone: true },
  });
  if (!prospect) {
    res.status(404).json({ success: false, error: 'Prospek tidak ditemukan' });
    return;
  }
  const photoUrl = await refreshProspectAvatar({ ...prospect, brandId }).catch(() => null);
  res.json({ success: true, data: { photoUrl } });
}));

// Batch: pastikan foto profil WhatsApp tersalin untuk prospek yang ditampilkan (Pipeline, Dashboard).
chatRouter.post('/avatars/refresh', asyncHandler(async (req, res) => {
  const input = z.object({
    brandId: z.coerce.number().int().positive().optional(),
    prospectIds: z.array(z.number().int().positive()).max(40),
  }).parse(req.body);
  const brandId = scopedBrandId(req, input.brandId);
  const prospects = await prisma.prospect.findMany({
    where: { brandId, id: { in: input.prospectIds } },
    select: { id: true, brandId: true, remoteJid: true, phone: true, photoUrl: true },
  });
  const data = await refreshProspectAvatars(prospects);
  res.json({ success: true, data });
}));

/**
 * Riwayat chat berhalaman: `limit` pesan terbaru (bawaan 100, maks. 1000), urut lama→baru. Pesan lebih lama
 * lewat cursor `beforeTs` + `beforeId` (pesan tertua yang sudah dimuat). Sebelumnya seluruh riwayat dikirim
 * sekaligus (±900 KB untuk 1.700 pesan) setiap chat dibuka.
 */
const messagePageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  beforeTs: z.coerce.number().int().nonnegative().optional(),
  beforeId: z.coerce.number().int().positive().optional(),
});
function pageWhere(page: z.infer<typeof messagePageSchema>): Prisma.ChatMessageWhereInput {
  if (page.beforeTs === undefined) return {};
  return {
    AND: [{
      OR: [
        { timestamp: { lt: page.beforeTs } },
        ...(page.beforeId ? [{ timestamp: page.beforeTs, id: { lt: page.beforeId } }] : []),
      ],
    }],
  };
}

chatRouter.get('/prospects/:id/messages', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const page = messagePageSchema.parse(req.query);
  const session = await prisma.whatsappSession.findUnique({ where: { brandId } });
  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { phone: true } });
  const ownPhones = new Set([
    normalizePhoneIdentifier(session?.phoneNumber),
    normalizePhoneIdentifier(brand?.phone),
  ].filter(Boolean));

  const { lidToPhone } = await buildLidPhoneMap(brandId, ownPhones);

  const target = await prisma.prospect.findFirst({ where: { id: Number(req.params.id), brandId }, select: { id: true, phone: true, remoteJid: true, devicePhone: true } });
  if (!target) throw new HttpError(404, 'Percakapan tidak ditemukan.');

  if (target.remoteJid && target.remoteJid.endsWith('@g.us')) {
    const data = await prisma.chatMessage.findMany({
      where: {
        brandId,
        remoteJid: target.remoteJid,
        isDeleted: false,
        messageType: { notIn: ['protocolMessage', 'reactionMessage'] },
        ...pageWhere(page),
      },
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: page.limit,
    });
    res.json({ success: true, data: data.reverse() });
    return;
  }

  // Alias nomor yang sama hanya dalam device yang sama: riwayat device lain tidak ikut tercampur.
  const prospects = await prisma.prospect.findMany({ where: { brandId, devicePhone: target.devicePhone }, select: { id: true, phone: true, remoteJid: true } });
  const key = conversationKey({ ...target, name: '' }, lidToPhone, ownPhones);
  const aliases = prospects.filter((item) => conversationKey({ ...item, name: '' }, lidToPhone, ownPhones) === key);
  const ids = aliases.map((item) => item.id);
  const phones = [...new Set(aliases.flatMap((item) => phoneAliases(item.phone)))];
  const remoteJids = [...new Set(aliases.map((item) => item.remoteJid).filter((value): value is string => Boolean(value)))];

  if (target.remoteJid && lidToPhone.has(target.remoteJid)) {
    const pn = lidToPhone.get(target.remoteJid)!;
    phones.push(...phoneAliases(pn));
  }

  const data = await prisma.chatMessage.findMany({
    where: {
      brandId,
      messageType: { notIn: ['protocolMessage', 'reactionMessage'] },
      ...(target.devicePhone ? { devicePhone: target.devicePhone } : {}),
      OR: [
        { prospectId: { in: ids } },
        ...(phones.length ? [{ phone: { in: phones } }] : []),
        ...(remoteJids.length ? [{ remoteJid: { in: remoteJids } }] : []),
      ],
      ...pageWhere(page),
    },
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    take: page.limit,
  });
  res.json({ success: true, data: data.reverse() });
}));

chatRouter.post('/prospects/:id/read', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const target = await prisma.prospect.findFirst({
    where: { id: Number(req.params.id), brandId },
    select: { id: true, phone: true, remoteJid: true, devicePhone: true, userId: true },
  });
  if (!target) {
    res.json({ success: true });
    return;
  }
  // Hanya penanggung jawab chat yang "membaca": PIC, atau CS/Admin pada chat tanpa PIC. Admin/Finance yang sekadar
  // memantau chat milik PIC lain tidak menghapus tanda belum dibaca PIC dan tidak memberi centang biru ke jamaah.
  const isAdmin = req.user!.role === 'superadmin' || req.user!.role === 'admin';
  const handlesChat = target.userId
    ? target.userId === req.user!.id
    : req.user!.role === 'cs' || isAdmin;

  const cleanPhone = normalizePhoneIdentifier(target.phone);
  const aliases = cleanPhone ? phoneAliases(cleanPhone) : [];
  const relatedProspects = await prisma.prospect.findMany({
    where: {
      brandId,
      devicePhone: target.devicePhone,
      OR: [
        { id: target.id },
        ...(target.remoteJid ? [{ remoteJid: target.remoteJid }] : []),
        ...(aliases.length ? [{ phone: { in: aliases } }] : []),
      ],
    },
    select: { id: true },
  });
  const prospectIds = relatedProspects.map((p) => p.id);
  // Chat dibuka pembaca: notifikasi "pesan baru" miliknya untuk percakapan ini selesai.
  for (const prospectId of prospectIds) {
    dispatch(() => resolveNotifications({ entity: { type: 'prospect', id: prospectId }, types: ['message.inbound'], userIds: [req.user!.id] }));
  }
  if (!handlesChat) {
    res.json({ success: true, data: { markedRead: 0, observerOnly: true } });
    return;
  }

  const unreadMessages = await prisma.chatMessage.findMany({
    where: {
      brandId,
      prospectId: { in: prospectIds },
      isFromMe: false,
      status: { not: 'read' },
    },
    select: { id: true, messageId: true, remoteJid: true },
  });

  if (unreadMessages.length > 0) {
    await prisma.chatMessage.updateMany({
      where: {
        id: { in: unreadMessages.map((m) => m.id) },
      },
      data: { status: 'read' },
    });
    scheduleConversationStats(prospectIds);
  }

  // Notify WhatsApp gateway to send read receipt to network & clear unread on real phone
  const waJid = target.remoteJid?.endsWith('@g.us')
    ? target.remoteJid
    : cleanPhone
    ? `${cleanPhone}@s.whatsapp.net`
    : target.remoteJid;

  // Centang biru hanya lewat nomor yang memegang percakapan ini.
  const activePhone = await activeDevicePhone(brandId);
  const sameDevice = !target.devicePhone || !activePhone || target.devicePhone === activePhone;
  if (waJid && sameDevice) {
    void fetch(`${env.WA_GATEWAY_URL}/sessions/${brandId}/read`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': env.WA_GATEWAY_SECRET,
      },
      body: JSON.stringify({
        jid: waJid,
        messageIds: unreadMessages.map((m) => m.messageId),
      }),
    }).catch(() => null);
  }

  emitToBrand(brandId, 'conversations:updated', { prospectId: target.id });
  emitToBrand(brandId, 'message:status', { prospectId: target.id, status: 'read' });

  res.json({ success: true, data: { markedRead: unreadMessages.length } });
}));

chatRouter.post('/prospects/:id/history-sync', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.body.brandId ? Number(req.body.brandId) : undefined);
  const session = await prisma.whatsappSession.findUnique({ where: { brandId } });
  if (session?.status !== 'connected') {
    res.json({ success: true, data: { requested: false, reason: 'Perangkat WhatsApp tidak terhubung.' } });
    return;
  }
  const target = await prisma.prospect.findFirst({ where: { id: Number(req.params.id), brandId }, select: { id: true, phone: true, remoteJid: true, devicePhone: true } });
  if (!target) throw new HttpError(404, 'Percakapan tidak ditemukan.');
  // Alias nomor yang sama hanya dalam device yang sama: riwayat device lain tidak ikut tercampur.
  const prospects = await prisma.prospect.findMany({ where: { brandId, devicePhone: target.devicePhone }, select: { id: true, phone: true, remoteJid: true } });
  const key = conversationKey({ ...target, name: '' });
  const aliases = prospects.filter((item) => conversationKey({ ...item, name: '' }) === key);
  const oldest = await prisma.chatMessage.findFirst({
    where: { brandId, isDeleted: false, prospectId: { in: aliases.map((item) => item.id) } },
    select: { messageId: true, remoteJid: true, phone: true, isFromMe: true, timestamp: true },
    orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
  });
  if (!oldest) {
    res.json({ success: true, data: { requested: false, reason: 'Percakapan belum memiliki titik awal histori.' } });
    return;
  }
  const response = await fetch(`${env.WA_GATEWAY_URL}/sessions/${brandId}/history`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': env.WA_GATEWAY_SECRET },
    body: JSON.stringify({ jid: oldest.remoteJid, phone: normalizePhoneIdentifier(oldest.phone || target.phone), messageId: oldest.messageId, isFromMe: oldest.isFromMe, timestamp: oldest.timestamp, count: 50 }),
  }).catch(() => null);
  if (!response?.ok) throw new HttpError(502, 'Sinkronisasi histori WhatsApp belum dapat dimulai.');
  const result = await response.json() as { data?: unknown };
  res.status(202).json({ success: true, data: { requested: true, gateway: result.data } });
}));

chatRouter.post('/messages', asyncHandler(async (req, res) => {
  const input = messageInputSchema.parse(req.body);
  const requestedBrandId = req.body?.brandId ? Number(req.body.brandId) : (req.query?.brandId ? Number(req.query.brandId) : undefined);

  const prospect = await prisma.prospect.findUnique({ where: { id: input.prospectId }, select: { brandId: true } });
  if (!prospect) throw new HttpError(404, 'Percakapan / Prospek tidak ditemukan.');
  const brandId = scopedBrandId(req, requestedBrandId ?? prospect.brandId);
  if (prospect.brandId !== brandId) throw new HttpError(404, 'Percakapan / Prospek tidak ditemukan.');

  const message = await sendTextToProspect({
    user: req.user!,
    brandId,
    prospectId: input.prospectId,
    text: input.text,
    quotedMessageId: input.quotedMessageId,
    quotedText: input.quotedText,
    quotedSender: input.quotedSender,
  });
  res.status(201).json({ success: true, data: message });
}));

// Media upload endpoint (base64 encoded or package flyer reference)
chatRouter.post('/messages/media', asyncHandler(async (req, res) => {
  const input = z.object({
    brandId: z.coerce.number().int().positive().optional(),
    prospectId: z.coerce.number().int().positive(),
    fileName: z.string().min(1).max(255).optional().default('media_file'),
    mimeType: z.string().min(1).max(100).optional().default('image/jpeg'),
    base64Data: z.string().max(40_000_000).optional(),
    packageId: z.coerce.number().int().positive().optional(),
    mediaType: z.enum(['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage']).optional().default('imageMessage'),
    caption: z.string().max(2048).optional().default(''),
    quotedMessageId: z.string().max(100).optional(),
    quotedText: z.string().max(4000).optional(),
    quotedSender: z.string().max(100).optional(),
  }).parse(req.body);

  const requestedBrandId = req.body?.brandId ? Number(req.body.brandId) : (req.query?.brandId ? Number(req.query.brandId) : undefined);

  const prospect = await prisma.prospect.findUnique({
    where: { id: input.prospectId },
    include: { user: { select: { id: true, name: true } }, package: true },
  });
  if (!prospect) throw new HttpError(404, 'Percakapan / Prospek tidak ditemukan.');

  const brandId = scopedBrandId(req, requestedBrandId ?? prospect.brandId);
  if (prospect.brandId !== brandId) throw new HttpError(404, 'Percakapan / Prospek tidak ditemukan.');
  const remoteJid = prospectChatJid(prospect);
  if (!remoteJid) throw new HttpError(422, 'Nomor WhatsApp prospek belum tersedia.');

  const isAdmin = req.user!.role === 'superadmin' || req.user!.role === 'admin';
  const isPic = Boolean(prospect.userId && prospect.userId === req.user!.id);
  const isUnassigned = !prospect.userId;

  if (!isAdmin && !isPic && !(isUnassigned && req.user!.role === 'cs')) {
    throw new HttpError(403, 'Hanya Admin dan PIC yang dapat mengirim media.');
  }
  // Paket yang ikut ditautkan harus milik brand percakapan ini.
  const linkedPackage = input.packageId
    ? await prisma.package.findFirst({ where: { id: input.packageId, brandId }, select: { id: true, flyerImage: true } })
    : null;
  if (input.packageId && !linkedPackage) throw new HttpError(404, 'Paket tidak ditemukan di brand ini.');

  const session = await prisma.whatsappSession.findUnique({ where: { brandId } });
  // Status di database bisa tertinggal; gateway yang memutuskan (409 bila memang putus).
  const devicePhone = sendingDevicePhone(prospect, session);

  // Resolve media file and base64Data (supports client-uploaded base64 or verified catalog package flyer)
  let resolvedBase64 = input.base64Data || '';
  let resolvedMimeType = input.mimeType;
  let resolvedFileName = input.fileName;
  let resolvedLocalUrl: string | null = null;

  if (!resolvedBase64 && linkedPackage) {
    // Flyer hanya dari paket brand yang sama dan hanya file hasil upload-flyer (R08).
    const pkg = linkedPackage;
    const flyerPath = await resolveFlyerFile(pkg?.flyerImage);
    if (pkg?.flyerImage && flyerPath) {
      const fileBuf = await fs.promises.readFile(flyerPath);
      resolvedBase64 = fileBuf.toString('base64');
      const ext = path.extname(flyerPath).toLowerCase();
      if (ext === '.png') resolvedMimeType = 'image/png';
      else if (ext === '.webp') resolvedMimeType = 'image/webp';
      else resolvedMimeType = 'image/jpeg';
      resolvedFileName = path.basename(flyerPath);
      resolvedLocalUrl = pkg.flyerImage;
    }
  }

  if (!resolvedBase64) {
    throw new HttpError(400, 'Berkas media atau flyer paket tidak ditemukan.');
  }

  // If packageId is provided and prospect does not have an assigned package, link the package
  if (linkedPackage && !prospect.packageId) {
    await prisma.prospect.update({
      where: { id: prospect.id },
      data: { packageId: linkedPackage.id },
    }).catch((err) => console.warn('Failed to auto-assign package to prospect:', err));
  }

  const phone = normalizePhoneIdentifier(prospect.phone);

  // Kutipan: pesan yang dibalas bisa milik jamaah atau pesan kita sendiri.
  let quotedText = input.quotedText;
  let quotedSender = input.quotedSender;
  let isQuotedFromMe = false;
  if (input.quotedMessageId) {
    const quoted = await prisma.chatMessage.findFirst({
      where: { brandId, messageId: input.quotedMessageId },
      select: { messageText: true, senderName: true, isFromMe: true },
    });
    if (quoted) {
      quotedText = quotedText || quoted.messageText || '';
      quotedSender = quotedSender || (quoted.isFromMe ? 'Anda' : (quoted.senderName || prospect.name || 'Jamaah'));
      isQuotedFromMe = quoted.isFromMe;
    }
  }

  // Save media file locally to uploads/media/ if not already a local file
  if (!resolvedLocalUrl) {
    try {
      // Ekstensi dari daftar putih (bukan dari nama file pengirim) dan nama acak: media chat tidak bisa
      // disajikan sebagai konten aktif dan URL-nya tidak bisa ditebak.
      const ext = safeChatMediaExtension(resolvedFileName, resolvedMimeType);
      const uniqueFileName = `${Date.now()}_${randomUUID()}${ext}`;
      const uploadsDir = path.resolve(process.cwd(), 'uploads', 'media');
      await fs.promises.mkdir(uploadsDir, { recursive: true });
      const filePath = path.join(uploadsDir, uniqueFileName);
      const buffer = Buffer.from(resolvedBase64, 'base64');
      await fs.promises.writeFile(filePath, buffer);
      resolvedLocalUrl = `/uploads/media/${uniqueFileName}`;
    } catch (err) {
      console.error('Failed to save uploaded media locally:', err);
    }
  }

  // Forward to WA gateway with base64 media
  const gatewayResponse = await fetch(`${env.WA_GATEWAY_URL}/sessions/${brandId}/media`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': env.WA_GATEWAY_SECRET },
    body: JSON.stringify({
      jid: remoteJid,
      fileName: resolvedFileName,
      mimeType: resolvedMimeType,
      base64Data: resolvedBase64,
      mediaType: input.mediaType,
      caption: input.caption,
      quotedMessageId: input.quotedMessageId,
      quotedText,
      isQuotedFromMe,
    }),
  }).catch(() => null);

  if (!gatewayResponse?.ok) throw await gatewayFailure(brandId, gatewayResponse, 'Gagal mengirim media ke WhatsApp. Coba lagi.');
  const gatewayResult = await gatewayResponse.json() as { data?: { messageId?: string; mediaUrl?: string } };

  const isNewClaim = !prospect.userId && req.user!.role === 'cs';
  let claimed = false;
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.chatMessage.create({
      data: {
        brandId,
        prospectId: prospect.id,
        messageId: gatewayResult.data?.messageId ?? `local-${randomUUID()}`,
        remoteJid,
        phone,
        devicePhone,
        senderName: req.user!.name,
        isFromMe: true,
        messageText: input.caption || resolvedFileName,
        messageType: input.mediaType,
        mediaUrl: resolvedLocalUrl || (gatewayResult.data?.mediaUrl ?? null),
        status: 'sent',
        timestamp: Math.floor(Date.now() / 1000),
        quotedMessageId: input.quotedMessageId,
        quotedText,
        quotedSender,
      },
    });

    // Bersyarat seperti kirim teks: tidak menimpa PIC yang diklaim CS lain di antara pengecekan dan pengiriman.
    if (isNewClaim) {
      const result = await tx.prospect.updateMany({ where: { id: prospect.id, userId: null }, data: { userId: req.user!.id } });
      claimed = result.count > 0;
      if (claimed) {
        await tx.prospectLog.create({
          data: { prospectId: prospect.id, userId: req.user!.id, actionType: 'pic_claimed', title: `PIC diklaim oleh ${req.user!.name}` },
        });
      }
    }

    // Auto-promote: new -> contact upon first outbound media
    const isFirstOutbound = prospect.status === 'new';
    if (isFirstOutbound) {
      await tx.prospect.update({ where: { id: prospect.id }, data: { status: 'contact' } });
      await tx.prospectLog.create({
        data: {
          prospectId: prospect.id,
          userId: req.user!.id,
          actionType: 'status_changed',
          title: 'Status otomatis menjadi Terhubung (contact)',
          description: 'Media pertama dikirim oleh CS',
        },
      });
    }

    await tx.prospectLog.create({
      data: { prospectId: prospect.id, userId: req.user!.id, actionType: 'message_sent', title: `Media dikirim oleh ${req.user!.name}: ${input.fileName}` },
    });
    return created;
  });

  if (claimed) {
    emitToBrand(brandId, 'prospect:claimed', { prospectIds: [prospect.id], userId: req.user!.id, userName: req.user!.name });
    dispatch(() => notifyPicChange({
      prospect: { id: prospect.id, brandId, name: prospect.name }, kind: 'claimed', fromUserId: null, toUserId: req.user!.id, actor: req.user!,
    }));
  }
  dispatch(() => resolveReplyNotifications(prospect.id));
  if (prospect.status === 'new') {
    emitToBrand(brandId, 'prospect:updated', { id: prospect.id, status: 'contact' });
    queueCapiForStatus(prospect.id, 'contact');
  }
  scheduleConversationStats([prospect.id]);
  emitToBrand(brandId, 'message:new', message);
  res.status(201).json({ success: true, data: message });
}));



chatRouter.post('/messages/:id/react', asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const input = z.object({
    emoji: z.string().max(10).default(''),
  }).parse(req.body);

  const message = await prisma.chatMessage.findUnique({
    where: { id },
    include: { prospect: { select: { userId: true, user: { select: { name: true } } } } },
  });
  if (!message) throw new HttpError(404, 'Pesan tidak ditemukan.');

  const requestedBrandId = req.body?.brandId ? Number(req.body.brandId) : (req.query?.brandId ? Number(req.query.brandId) : undefined);
  const brandId = scopedBrandId(req, requestedBrandId ?? message.brandId);
  if (message.brandId !== brandId) throw new HttpError(404, 'Pesan tidak ditemukan.');

  const isAdmin = req.user!.role === 'superadmin' || req.user!.role === 'admin';
  const isPic = Boolean(message.prospect?.userId && message.prospect.userId === req.user!.id);
  const isUnassigned = !message.prospect?.userId;

  if (!isAdmin && !isPic && !(isUnassigned && req.user!.role === 'cs')) {
    throw new HttpError(403, 'Hanya Admin dan PIC yang dapat memberi reaksi pesan.');
  }

  const targetEmoji = input.emoji.trim();
  const isRemovingReaction = targetEmoji === '';

  // Jika ingin hapus reaction:
  if (isRemovingReaction || message.reaction === targetEmoji) {
    // Reaction dari prospek (reactionUserId null, isFromMe false) → tidak bisa dihapus oleh CS
    if (message.reaction && message.reactionUserId === null && !message.isFromMe) {
      throw new HttpError(403, 'Reaction dari jamaah tidak dapat dihapus.');
    }
    // Hanya pengirim reaction yang boleh hapus (kecuali admin/superadmin)
    if (message.reaction && message.reactionUserId !== null && message.reactionUserId !== req.user!.id && !isAdmin) {
      throw new HttpError(403, 'Hanya pengirim reaction yang dapat menghapusnya.');
    }
  }

  // Toggle: if already reacted with same emoji by same user → remove; otherwise set new
  const isSameReactionBySameUser = message.reaction === targetEmoji && message.reactionUserId === req.user!.id;
  const newReaction = (isRemovingReaction || isSameReactionBySameUser) ? null : (targetEmoji || null);
  const newReactionUserId = newReaction ? req.user!.id : null;

  const remoteJid = message.remoteJid || (message.phone ? `${message.phone.replace(/\D/g, '')}@s.whatsapp.net` : null);
  if (!remoteJid) throw new HttpError(422, 'Remote JID tidak valid.');

  const session = await prisma.whatsappSession.findUnique({ where: { brandId } });
  // Status di database bisa tertinggal; gateway yang memutuskan (409 bila memang putus).
  // Reaksi hanya lewat nomor yang menerima/mengirim pesan itu.
  sendingDevicePhone(message, session);

  const gatewayResponse = await fetch(`${env.WA_GATEWAY_URL}/sessions/${brandId}/react`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': env.WA_GATEWAY_SECRET },
    body: JSON.stringify({
      jid: remoteJid,
      messageId: message.messageId,
      isFromMe: message.isFromMe,
      emoji: newReaction ?? '',
    }),
  }).catch(() => null);

  if (!gatewayResponse?.ok) throw await gatewayFailure(brandId, gatewayResponse, 'Gagal mengirim reaction ke WhatsApp.');

  const updated = await prisma.chatMessage.update({
    where: { id },
    data: { reaction: newReaction, reactionUserId: newReactionUserId },
  });

  emitToBrand(brandId, 'message:reaction', {
    id: updated.id,
    messageId: updated.messageId,
    reaction: newReaction,
    reactionUserId: newReactionUserId,
  });

  res.json({ success: true, data: updated });
}));


chatRouter.delete('/messages/:id', asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);

  const message = await prisma.chatMessage.findUnique({
    where: { id },
    include: { prospect: { select: { userId: true } } },
  });
  if (!message) throw new HttpError(404, 'Pesan tidak ditemukan.');

  const requestedBrandId = req.query?.brandId ? Number(req.query.brandId) : undefined;
  const brandId = scopedBrandId(req, requestedBrandId ?? message.brandId);
  if (message.brandId !== brandId) throw new HttpError(404, 'Pesan tidak ditemukan.');

  if (!message.isFromMe) {
    throw new HttpError(400, 'Hanya pesan yang dikirim yang dapat dihapus.');
  }

  const isAdmin = req.user!.role === 'superadmin' || req.user!.role === 'admin';
  const isPic = Boolean(message.prospect?.userId && message.prospect.userId === req.user!.id);

  if (!isAdmin && !isPic) {
    throw new HttpError(403, 'Hanya Admin dan PIC yang dapat menghapus pesan.');
  }
  if (message.isDeleted) throw new HttpError(409, 'Pesan sudah dihapus.');
  // WhatsApp hanya menerima "hapus untuk semua" dalam ±2 hari sejak pesan dikirim.
  if (Date.now() / 1000 - message.timestamp > DELETE_FOR_EVERYONE_SECONDS) {
    throw new HttpError(422, 'Pesan lebih dari 2 hari tidak bisa lagi dihapus untuk semua orang di WhatsApp.');
  }
  if (message.messageId.startsWith('local-')) throw new HttpError(422, 'Pesan ini tidak tercatat di WhatsApp sehingga tidak bisa ditarik.');
  const remoteJid = message.remoteJid || (message.phone ? `${message.phone.replace(/\D/g, '')}@s.whatsapp.net` : null);
  if (!remoteJid) throw new HttpError(422, 'Remote JID tidak valid.');

  const session = await prisma.whatsappSession.findUnique({ where: { brandId } });
  // Status di database bisa tertinggal; gateway yang memutuskan (409 bila memang putus).
  // Hanya nomor pengirimnya yang bisa menarik pesan.
  sendingDevicePhone(message, session);

  // Tarik di WhatsApp dulu; CRM baru menandai terhapus bila jamaah juga tidak lagi melihatnya.
  const gatewayResponse = await fetch(`${env.WA_GATEWAY_URL}/sessions/${brandId}/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': env.WA_GATEWAY_SECRET },
    body: JSON.stringify({ jid: remoteJid, messageId: message.messageId, isFromMe: message.isFromMe }),
  }).catch(() => null);
  if (!gatewayResponse?.ok) throw await gatewayFailure(brandId, gatewayResponse, 'Gagal menarik pesan di WhatsApp. Pesan tidak dihapus.');

  const updated = await prisma.chatMessage.update({
    where: { id },
    data: { isDeleted: true, deletedAt: new Date() },
  });
  scheduleConversationStats([updated.prospectId]);

  emitToBrand(brandId, 'message:deleted', {
    id: updated.id,
    messageId: updated.messageId,
    isDeleted: true,
    deletedAt: updated.deletedAt,
  });

  res.json({ success: true, data: updated });
}));

chatRouter.post('/messages/:id/star', asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);

  const message = await prisma.chatMessage.findUnique({
    where: { id },
    include: { prospect: { select: { userId: true } } },
  });
  if (!message) throw new HttpError(404, 'Pesan tidak ditemukan.');

  const requestedBrandId = req.query?.brandId ? Number(req.query.brandId) : undefined;
  const brandId = scopedBrandId(req, requestedBrandId ?? message.brandId);
  if (message.brandId !== brandId) throw new HttpError(404, 'Pesan tidak ditemukan.');

  // Sama seperti reaksi: Admin, PIC, atau CS pada percakapan yang belum ber-PIC.
  const isAdmin = req.user!.role === 'superadmin' || req.user!.role === 'admin';
  const isPic = Boolean(message.prospect?.userId && message.prospect.userId === req.user!.id);
  if (!isAdmin && !isPic && !(!message.prospect?.userId && req.user!.role === 'cs')) {
    throw new HttpError(403, 'Hanya Admin dan PIC yang dapat menandai pesan.');
  }

  const nextStarred = !(message as any).isStarred;
  const updated = await prisma.chatMessage.update({
    where: { id },
    data: { isStarred: nextStarred } as any,
  });

  emitToBrand(brandId, 'message:starred', {
    id: updated.id,
    messageId: updated.messageId,
    isStarred: nextStarred,
  });

  res.json({ success: true, data: updated });
}));

chatRouter.get('/wa/status', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  let data = await prisma.whatsappSession.findUnique({ where: { brandId } });
  const statusBefore = data?.status;

  // Probe gateway paling sering sekali per STATUS_PROBE_MS per brand; di antaranya status dari database (yang
  // juga diperbarui gateway lewat webhook) sudah cukup untuk polling Inbox setiap tab.
  const probeDue = Date.now() - (statusProbedAt.get(brandId) ?? 0) >= STATUS_PROBE_MS;
  if (probeDue) {
    statusProbedAt.set(brandId, Date.now());
    data = await syncSessionWithGateway(brandId, data);
  }

  if (data && data.status !== statusBefore) void onWhatsappStatus(brandId, data.status);

  // Dipakai Inbox semua role: QR pairing hanya untuk pengelola perangkat.
  const canPairDevice = req.user!.role === 'superadmin' || req.user!.role === 'admin';
  res.json({
    success: true,
    data: data ? { ...data, qrCode: canPairDevice ? data.qrCode : null } : { brandId, status: 'disconnected' },
  });
}));

export const internalRouter = Router();
internalRouter.use((req, _res, next) => (secretMatches(req.get('x-internal-secret'), env.WA_GATEWAY_SECRET) ? next() : next(new HttpError(401, 'Internal secret tidak valid.'))));

const gatewayMessageSchema = z.object({
  brandId: z.coerce.number().int().positive(),
  messageId: z.string().min(1).max(100),
  remoteJid: z.string().min(3).max(100),
  phone: z.string().max(30).optional().default(''),
  senderName: z.string().max(100).optional(),
  text: z.string().optional().default(''),
  timestamp: z.coerce.number().int().nonnegative(),
  messageType: z.string().max(30).optional().default('conversation'),
  mediaUrl: z.string().max(10_000).optional(),
  isFromMe: z.boolean().optional().default(false),
  status: z.string().max(30).optional().default('delivered'),
  referral: z.unknown().optional(),
  // Nomor akun WhatsApp yang menerima/mengirim pesan (dari gateway).
  devicePhone: z.string().max(40).optional(),
});

type GatewayMessageInput = z.infer<typeof gatewayMessageSchema>;

/**
 * Prospek Baru yang sudah dibalas (dari HP maupun CRM) berpindah ke Terhubung. Bersyarat status 'new' agar balasan
 * berikutnya atau tahap yang sudah lebih jauh tidak tersentuh.
 */
async function promoteRepliedProspect(prospectId: number, brandId: number, realtime: boolean) {
  const promoted = await prisma.prospect.updateMany({ where: { id: prospectId, status: 'new' }, data: { status: 'contact' } });
  if (!promoted.count) return;
  await prisma.prospectLog.create({
    data: {
      prospectId,
      userId: null,
      actionType: 'status_changed',
      title: 'Status otomatis menjadi Terhubung (contact)',
      description: 'Dibalas langsung dari WhatsApp di HP',
    },
  });
  if (realtime) emitToBrand(brandId, 'prospect:updated', { id: prospectId, status: 'contact' });
  queueCapiForStatus(prospectId, 'contact');
}

async function ingestGatewayMessage(input: GatewayMessageInput, options: { realtime: boolean }) {
  const { brandId, messageId, remoteJid, senderName, text, timestamp, messageType, mediaUrl, isFromMe, referral } = input;
  if (
    !remoteJid ||
    remoteJid === 'status@broadcast' ||
    remoteJid === '0@s.whatsapp.net' ||
    remoteJid.startsWith('0@') ||
    remoteJid.endsWith('@newsletter') ||
    remoteJid.endsWith('@g.us') ||
    remoteJid.endsWith('@broadcast')
  ) {
    return null;
  }
  // Pasangan @lid↔nomor baru bisa menggabungkan dua percakapan: peta di-cache dibangun ulang.
  if (remoteJid.endsWith('@lid') && input.phone) invalidateLidPhoneMap(brandId);
  if (messageType === 'protocolMessage' || messageType === 'reactionMessage') {
    return null;
  }
  const hasContent = Boolean(text?.trim()) || Boolean(mediaUrl) || ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage', 'contactMessage', 'locationMessage'].includes(messageType);
  if (!hasContent) {
    return null;
  }

  const session = await prisma.whatsappSession.findUnique({ where: { brandId } });
  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { phone: true } });
  // Percakapan diikat ke device yang menerimanya. Sumber utama: nomor akun dari gateway (pasti benar walau status sesi
  // di database sesaat kosong saat sambung ulang); status sesi hanya cadangan untuk gateway versi lama.
  const devicePhone = normalizePhoneIdentifier(input.devicePhone) || normalizePhoneIdentifier(session?.phoneNumber) || undefined;
  const ownPhones = new Set([
    devicePhone,
    normalizePhoneIdentifier(session?.phoneNumber),
    normalizePhoneIdentifier(brand?.phone),
  ].filter(Boolean));

  let rawPhone = normalizePhoneIdentifier(input.phone);
  if (rawPhone && ownPhones.has(rawPhone)) {
    rawPhone = '';
  }
  if (ownPhones.has(normalizePhoneIdentifier(remoteJid))) {
    return null;
  }

  if (!rawPhone && remoteJid.endsWith('@lid')) {
    const prevMsg = await prisma.chatMessage.findFirst({
      where: { brandId, remoteJid, phone: { not: '' } },
      select: { phone: true },
    });
    const mapped = normalizePhoneIdentifier(prevMsg?.phone);
    if (mapped && !ownPhones.has(mapped)) {
      rawPhone = mapped;
    }
  }

  const isGroup = remoteJid.endsWith('@g.us');
  const phone = isGroup ? '' : rawPhone;
  const referralMarker = normalizeReferralMarker(referral);
  const aliases = phoneAliases(phone);

  // Beda device, beda percakapan: orang yang sama di nomor brand lain adalah prospek & riwayat terpisah.
  const candidates = await prisma.prospect.findMany({
    where: {
      brandId,
      ...(devicePhone ? { devicePhone } : {}),
      OR: [
        { remoteJid },
        ...(!isGroup && aliases.length ? [{ phone: { in: aliases } }] : []),
      ],
    },
    select: { id: true, name: true, phone: true, remoteJid: true, packageId: true, userId: true, notes: true, updatedAt: true }
  });

  let prospect = candidates.length ? chooseCanonicalProspect(candidates) : null;
  let referralCaptured = false;

  // Pesan keluar membawa pushName akun WhatsApp brand sendiri, bukan nama kontak: jangan dipakai sebagai nama prospek.
  const senderContactName = isFromMe ? undefined : senderName?.trim();
  // Nama pengirim pesan masuk; bila tidak ada (pesan keluar / riwayat tanpa pushName), nama kontak WhatsApp tersimpan
  // untuk device ini. Dicari hanya saat nama prospek memang perlu diisi.
  // Kontak tersimpan dicari lewat nomor, atau lewat ID @lid bila WhatsApp menyembunyikan nomornya.
  const contactKeys = [...aliases, ...(remoteJid.endsWith('@lid') ? [remoteJid] : [])];
  const knownName = async () => senderContactName || (!isGroup && devicePhone && contactKeys.length
    ? (await prisma.whatsappContact.findFirst({ where: { brandId, devicePhone, phone: { in: contactKeys } }, select: { name: true } }))?.name
    : undefined);
  const validSenderName = !prospect || isGenericContactName(prospect.name, prospect.phone) ? await knownName() : undefined;
  const fallbackName = isGroup
    ? (validSenderName || 'Grup WhatsApp')
    : (validSenderName || (phone ? `+${phone}` : 'Kontak WhatsApp'));

  let autoAssigned: { id: number; name: string } | null = null;
  const isNewProspect = !prospect;
  if (!prospect) {
    // Lead baru dari jamaah langsung punya PIC: CS aktif brand ini (termasuk CS multi-brand) dengan prospek terbuka paling sedikit.
    autoAssigned = (isFromMe || isGroup) ? null : await pickAutoAssignee(brandId);
    prospect = await prisma.prospect.create({
      data: {
        brandId,
        userId: autoAssigned?.id ?? null,
        name: isGroup ? 'Grup WhatsApp' : fallbackName,
        phone: isGroup ? null : (phone || null),
        remoteJid: isGroup ? remoteJid : phone ? `${phone}@s.whatsapp.net` : remoteJid,
        devicePhone,
        leadSource: isGroup ? 'whatsapp_group' : (referralMarker ? 'meta_ads' : 'whatsapp'),
        metaReferralMarker: referralMarker?.ctwaClid,
        adId: referralMarker?.adId,
        campaignId: referralMarker?.campaignId,
        adHeadline: referralMarker?.headline,
        adSourceUrl: referralMarker?.sourceUrl
      }
    });
    referralCaptured = Boolean(referralMarker);
    if (autoAssigned) {
      await prisma.prospectLog.create({
        data: {
          prospectId: prospect.id,
          userId: null,
          actionType: 'pic_assigned',
          title: `PIC ditetapkan otomatis ke ${autoAssigned.name}`,
          description: 'Lead baru dibagi ke CS dengan prospek terbuka paling sedikit',
        },
      });
      emitToBrand(brandId, 'prospect:claimed', { prospectIds: [prospect.id], userId: autoAssigned.id, userName: autoAssigned.name, auto: true });
    }
  } else {
    referralCaptured = await attachReferralMarker(prospect.id, referralMarker);
    const targetJid = isGroup ? remoteJid : phone ? `${phone}@s.whatsapp.net` : remoteJid;
    const shouldUpdateJid = !prospect.remoteJid || (!isGroup && phone && prospect.remoteJid.endsWith('@lid'));
    const nameIsGeneric = isGenericContactName(prospect.name, prospect.phone);

    prospect = await prisma.prospect.update({
      where: { id: prospect.id },
      data: {
        ...(!isGroup && !prospect.phone && phone ? { phone } : {}),
        ...(shouldUpdateJid ? { remoteJid: targetJid } : {}),
        ...(!isGroup && nameIsGeneric && validSenderName ? { name: validSenderName } : {}),
      },
      select: { id: true, name: true, phone: true, remoteJid: true, packageId: true, userId: true, notes: true, updatedAt: true }
    });
  }

  // Gateway bisa mengirim ulang pesan yang sama: notifikasi pesan masuk hanya untuk pesan yang baru tersimpan.
  const alreadyStored = options.realtime && !isFromMe
    ? await prisma.chatMessage.findUnique({ where: { brandId_messageId: { brandId, messageId } }, select: { id: true } })
    : null;

  const previousOwner = await prisma.chatMessage.findUnique({ where: { brandId_messageId: { brandId, messageId } }, select: { prospectId: true } });
  const message = await prisma.chatMessage.upsert({
    where: { brandId_messageId: { brandId, messageId } },
    update: {
      prospectId: prospect.id,
      remoteJid,
      phone: phone || (input.phone || ''),
      ...(devicePhone ? { devicePhone } : {}),
      senderName,
      isFromMe,
      messageText: text,
      messageType,
      ...(mediaUrl ? { mediaUrl } : {}),
      timestamp: timestamp || Math.floor(Date.now() / 1000),
      status: input.status || 'delivered',
      metaReferralData: referralMarker ?? undefined
    },
    create: {
      brandId,
      prospectId: prospect.id,
      messageId,
      remoteJid,
      phone: phone || (input.phone || ''),
      devicePhone,
      senderName,
      isFromMe,
      messageText: text,
      messageType,
      mediaUrl,
      timestamp: timestamp || Math.floor(Date.now() / 1000),
      status: input.status || 'delivered',
      metaReferralData: referralMarker ?? undefined
    }
  });

  scheduleConversationStats([message.prospectId, previousOwner?.prospectId]);
  // Dibalas langsung dari HP WhatsApp: sama seperti balasan dari CRM, prospek Baru menjadi Terhubung.
  if (isFromMe && !isGroup) await promoteRepliedProspect(prospect.id, brandId, options.realtime);
  if (options.realtime) emitToBrand(brandId, 'message:new', message);
  if (options.realtime) {
    const ref = { id: prospect.id, brandId, name: prospect.name, userId: prospect.userId };
    const assignee = autoAssigned;
    if (isFromMe) {
      // Dibalas langsung dari HP perangkat: pengingat balasan selesai seperti balasan dari aplikasi.
      dispatch(() => resolveReplyNotifications(ref.id));
    } else if (isNewProspect) {
      // Lead tanpa PIC tidak diberi notifikasi per lead: ringkasan per brand diperbarui job SLA tiap menit.
      if (assignee) dispatch(() => notifyLeadAssigned(ref, assignee.id));
    } else if (!alreadyStored) {
      dispatch(() => notifyInboundMessage(ref, { text, messageType }));
    }
  }
  if (options.realtime && referralCaptured) void dispatchCapiEvent(prospect.id, 'LeadSubmitted').catch((error) => console.error('CAPI LeadSubmitted dispatch failed', error));
  return message;
}

internalRouter.post('/messages/status', asyncHandler(async (req, res) => {
  const input = z.object({
    brandId: z.coerce.number().int().positive(),
    messageId: z.string().min(1).max(100),
    status: z.enum(['pending', 'sent', 'delivered', 'read', 'failed']),
  }).parse(req.body);

  const statusCondition = input.status === 'delivered'
    ? { in: ['pending', 'sent'] }
    : input.status === 'read'
    ? { in: ['pending', 'sent', 'delivered'] }
    : undefined;

  const updated = await prisma.chatMessage.updateMany({
    where: {
      brandId: input.brandId,
      messageId: input.messageId,
      ...(statusCondition ? { status: statusCondition } : {}),
    },
    data: { status: input.status },
  });

  if (updated.count > 0) {
    const owner = await prisma.chatMessage.findUnique({ where: { brandId_messageId: { brandId: input.brandId, messageId: input.messageId } }, select: { prospectId: true } });
    scheduleConversationStats([owner?.prospectId]);
    emitToBrand(input.brandId, 'message:status', {
      messageId: input.messageId,
      status: input.status,
      prospectId: owner?.prospectId,
    });
  }

  res.json({ success: true, data: { updated: updated.count } });
}));

internalRouter.post('/chats/read', asyncHandler(async (req, res) => {
  const input = z.object({
    brandId: z.coerce.number().int().positive(),
    devicePhone: z.string().max(40).optional(),
    remoteJid: z.string().min(3).max(100),
  }).parse(req.body);

  const cleanPhone = normalizePhoneIdentifier(input.remoteJid);
  const aliases = cleanPhone ? phoneAliases(cleanPhone) : [];
  // Status baca datang dari device yang sedang tersambung: percakapan device lain tidak ikut berubah.
  const devicePhone = normalizePhoneIdentifier(input.devicePhone) || await activeDevicePhone(input.brandId);

  const prospects = await prisma.prospect.findMany({
    where: {
      brandId: input.brandId,
      ...(devicePhone ? { devicePhone } : {}),
      OR: [
        { remoteJid: input.remoteJid },
        ...(aliases.length ? [{ phone: { in: aliases } }] : []),
      ],
    },
    select: { id: true },
  });
  const prospectIds = prospects.map((p) => p.id);

  const updated = await prisma.chatMessage.updateMany({
    where: {
      brandId: input.brandId,
      ...(devicePhone ? { devicePhone } : {}),
      OR: [
        ...(prospectIds.length ? [{ prospectId: { in: prospectIds } }] : []),
        { remoteJid: input.remoteJid },
        ...(aliases.length ? [{ phone: { in: aliases } }] : []),
      ],
      isFromMe: false,
      status: { not: 'read' },
    },
    data: { status: 'read' },
  });

  if (updated.count > 0) {
    scheduleConversationStats(prospectIds);
    emitToBrand(input.brandId, 'conversations:updated', { remoteJid: input.remoteJid });
    emitToBrand(input.brandId, 'message:status', { remoteJid: input.remoteJid, status: 'read' });
  }

  res.json({ success: true, data: { markedRead: updated.count } });
}));

internalRouter.post('/messages/reaction', asyncHandler(async (req, res) => {
  const input = z.object({
    brandId: z.coerce.number().int().positive(),
    messageId: z.string().min(1).max(100),
    emoji: z.string().nullable().optional(),
  }).parse(req.body);

  const reaction = input.emoji && input.emoji.trim() ? input.emoji.trim() : null;

  const updated = await prisma.chatMessage.updateMany({
    where: { brandId: input.brandId, messageId: input.messageId },
    data: { reaction },
  });

  if (updated.count > 0) {
    emitToBrand(input.brandId, 'message:reaction', {
      messageId: input.messageId,
      reaction,
    });
  }

  res.json({ success: true, data: { updated: updated.count } });
}));

/** Pengirim menarik pesannya ("hapus untuk semua") di WhatsApp: tandai terhapus seperti hapus dari CRM. */
internalRouter.post('/messages/revoked', asyncHandler(async (req, res) => {
  const input = z.object({ brandId: z.coerce.number().int().positive(), messageId: z.string().min(1).max(100) }).parse(req.body);
  const message = await prisma.chatMessage.findUnique({ where: { brandId_messageId: { brandId: input.brandId, messageId: input.messageId } }, select: { id: true, prospectId: true, isDeleted: true } });
  if (message && !message.isDeleted) {
    const updated = await prisma.chatMessage.update({ where: { id: message.id }, data: { isDeleted: true, deletedAt: new Date() } });
    scheduleConversationStats([updated.prospectId]);
    emitToBrand(input.brandId, 'message:deleted', { id: updated.id, messageId: updated.messageId, isDeleted: true, deletedAt: updated.deletedAt });
  }
  res.json({ success: true });
}));

/** Pengirim mengedit pesannya di WhatsApp: teks di CRM ikut berubah. */
internalRouter.post('/messages/edited', asyncHandler(async (req, res) => {
  const input = z.object({ brandId: z.coerce.number().int().positive(), messageId: z.string().min(1).max(100), text: z.string().max(65_000) }).parse(req.body);
  const message = await prisma.chatMessage.findUnique({ where: { brandId_messageId: { brandId: input.brandId, messageId: input.messageId } }, select: { id: true } });
  if (message) {
    const updated = await prisma.chatMessage.update({ where: { id: message.id }, data: { messageText: input.text } });
    scheduleConversationStats([updated.prospectId]);
    emitToBrand(input.brandId, 'message:edited', { id: updated.id, messageId: updated.messageId, messageText: updated.messageText });
  }
  res.json({ success: true });
}));

internalRouter.post('/messages/incoming', asyncHandler(async (req, res) => {
  const input = gatewayMessageSchema.parse(req.body);
  const message = await ingestGatewayMessage(input, { realtime: true });
  res.status(201).json({ success: true, data: message });
}));

internalRouter.post('/messages/history', asyncHandler(async (req, res) => {
  const input = z.object({ brandId: z.coerce.number().int().positive(), devicePhone: z.string().max(40).optional(), messages: z.array(gatewayMessageSchema).max(100) }).parse(req.body);
  const messages = [];
  for (const item of input.messages) {
    if (item.brandId !== input.brandId) throw new HttpError(400, 'Brand histori pesan tidak konsisten.');
    const result = await ingestGatewayMessage({ ...item, devicePhone: item.devicePhone ?? input.devicePhone }, { realtime: false });
    if (result) messages.push(result);
  }
  const latest = messages.sort((a, b) => b.timestamp - a.timestamp)[0];
  if (latest) emitToBrand(input.brandId, 'message:new', latest);
  res.status(201).json({ success: true, data: { imported: messages.length } });
}));

const gatewayContactSchema = z.object({
  brandId: z.coerce.number().int().positive(),
  remoteJid: z.string().min(3).max(100),
  phone: z.string().max(30).optional().default(''),
  name: z.string().trim().min(1).max(100).optional(),
});

internalRouter.post('/contacts/sync', asyncHandler(async (req, res) => {
  const input = z.object({
    brandId: z.coerce.number().int().positive(),
    devicePhone: z.string().max(40).optional(),
    contacts: z.array(gatewayContactSchema).max(100),
  }).parse(req.body);
  let imported = 0;
  invalidateLidPhoneMap(input.brandId);
  const devicePhone = normalizePhoneIdentifier(input.devicePhone) || await activeDevicePhone(input.brandId);
  for (const contact of input.contacts) {
    if (contact.brandId !== input.brandId) throw new HttpError(400, 'Brand kontak tidak konsisten.');
    const phone = normalizePhoneIdentifier(contact.phone);
    // WhatsApp makin sering menyembunyikan nomor (alamat @lid). Kontak seperti itu tetap membawa nama profil:
    // disimpan & dicocokkan lewat ID @lid-nya, bukan dibuang.
    const lid = contact.remoteJid.endsWith('@lid') ? contact.remoteJid : '';
    const contactKey = phone || lid;
    if (!contactKey) continue;
    // Kontak sering tiba sebelum chat-nya tersimpan: namanya disimpan agar dipakai saat prospek dibuat belakangan.
    if (devicePhone && contact.name && !isGenericContactName(contact.name, phone)) {
      await prisma.whatsappContact.upsert({
        where: { brandId_devicePhone_phone: { brandId: input.brandId, devicePhone, phone: contactKey } },
        update: { name: contact.name },
        create: { brandId: input.brandId, devicePhone, phone: contactKey, name: contact.name },
      });
    }
    const aliases = phone ? phoneAliases(phone) : [];
    const candidates = await prisma.prospect.findMany({
      where: { brandId: input.brandId, ...(devicePhone ? { devicePhone } : {}), OR: [{ remoteJid: contact.remoteJid }, ...(aliases.length ? [{ phone: { in: aliases } }] : [])] },
      select: { id: true, name: true, phone: true, remoteJid: true, packageId: true, userId: true, notes: true, updatedAt: true },
    });
    const existing = candidates.length ? chooseCanonicalProspect(candidates) : null;
    if (!existing) {
      // Jangan buat prospek baru dari kontak buku telepon kosong.
      // Kontak buku telepon hanya dipakai untuk memperkaya nama prospek yang sudah ada riwayat chat-nya.
      continue;
    }
    const existingNameIsGeneric = isGenericContactName(existing.name, existing.phone);
    await prisma.prospect.update({
      where: { id: existing.id },
      data: {
        ...(!existing.phone && phone ? { phone } : {}),
        ...((!existing.remoteJid || contact.remoteJid.endsWith('@lid')) ? { remoteJid: contact.remoteJid } : {}),
        ...(contact.name && (existingNameIsGeneric || !existing.name) ? { name: contact.name } : {}),
      },
    });
    imported += 1;
  }
  if (imported) emitToBrand(input.brandId, 'contacts:synced', { imported });
  res.status(201).json({ success: true, data: { imported } });
}));

internalRouter.post('/wa/status', asyncHandler(async (req, res) => {
  const input = z.object({
    brandId: z.coerce.number().int().positive(),
    status: z.enum(['disconnected', 'connecting', 'connected', 'qr_ready']),
    qrCode: z.string().max(1_000_000).nullable().optional(),
    phoneNumber: z.string().max(30).nullable().optional(),
    reason: z.string().max(30).optional(),
  }).parse(req.body);
  const qrCode = input.status === 'qr_ready' ? input.qrCode ?? null : null;
  const phoneNumber = input.status === 'connected' ? input.phoneNumber ?? undefined : input.status === 'disconnected' ? null : undefined;
  // Alasan dipertahankan selama mencoba menyambung ulang; hilang hanya saat benar-benar tersambung.
  const disconnectReason = input.status === 'connected' ? null : input.status === 'disconnected' ? input.reason ?? 'connection_lost' : undefined;
  const session = await prisma.whatsappSession.upsert({
    where: { brandId: input.brandId },
    update: { status: input.status, qrCode, phoneNumber, disconnectReason, lastConnectedAt: input.status === 'connected' ? new Date() : undefined },
    create: { brandId: input.brandId, sessionName: `brand_${input.brandId}`, status: input.status, qrCode, phoneNumber: phoneNumber ?? null, disconnectReason: disconnectReason ?? null },
  });
  if (input.status === 'connected') await adoptUnassignedProspects(input.brandId, session.phoneNumber);
  emitToBrand(input.brandId, input.status === 'qr_ready' ? 'wa:qr' : 'wa:status', session);
  void onWhatsappStatus(input.brandId, input.status);
  res.json({ success: true, data: session });
}));
