import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { messageInputSchema } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { authGuard, scopedBrandId } from '../../middleware/auth.js';
import { emitToBrand } from '../../realtime/socket.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { dispatchCapiEvent } from '../capi/capi.service.js';
import { attachReferralMarker, normalizeReferralMarker } from '../prospects/referral.service.js';

export const chatRouter = Router();
chatRouter.use(authGuard);

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

function normalizePhoneIdentifier(value?: string | null) {
  if (!value || value.endsWith('@lid') || value.endsWith('@g.us')) return '';
  const digits = value.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') ?? '';
  if (!digits || digits === '0') return '';
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

function phoneAliases(value?: string | null) {
  const normalized = normalizePhoneIdentifier(value);
  if (!normalized) return [];
  return [...new Set([
    normalized,
    `+${normalized}`,
    normalized.startsWith('62') ? `0${normalized.slice(2)}` : normalized,
  ])];
}

function conversationKey(prospect: ProspectIdentity) {
  const phone = normalizePhoneIdentifier(prospect.phone) || normalizePhoneIdentifier(prospect.remoteJid);
  return phone ? `phone:${phone}` : `jid:${prospect.remoteJid ?? prospect.id}`;
}

function prospectScore(prospect: ProspectIdentity) {
  const genericName = /^\+?\d+$/.test(prospect.name.trim()) || prospect.name.trim() === prospect.phone;
  return (genericName ? 0 : 100)
    + (prospect.packageId ? 20 : 0)
    + (prospect.userId ? 10 : 0)
    + (prospect.notes ? 5 : 0)
    + (prospect.messages?.[0]?.timestamp ?? 0) / 1_000_000_000;
}

function chooseCanonicalProspect<T extends ProspectIdentity>(prospects: T[]) {
  return [...prospects].sort((a, b) => prospectScore(b) - prospectScore(a))[0]!;
}

chatRouter.get('/conversations', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const prospects = await prisma.prospect.findMany({ where: { brandId }, select: { id: true, name: true, phone: true, photoUrl: true, status: true, remoteJid: true, packageId: true, userId: true, notes: true, leadSource: true, adId: true, campaignId: true, adHeadline: true, adSourceUrl: true, updatedAt: true, user: { select: { id: true, name: true } }, package: { select: { id: true, name: true } }, messages: { where: { isDeleted: false }, orderBy: { timestamp: 'desc' }, take: 1 } }, orderBy: { updatedAt: 'desc' } });
  const grouped = new Map<string, typeof prospects>();
  for (const prospect of prospects) {
    const key = conversationKey(prospect);
    grouped.set(key, [...(grouped.get(key) ?? []), prospect]);
  }
  const data = [...grouped.values()].map((group) => {
    const canonical = chooseCanonicalProspect(group);
    const latest = group.flatMap((item) => item.messages).sort((a, b) => b.timestamp - a.timestamp)[0];
    return { ...canonical, messages: latest ? [latest] : [], duplicateIds: group.map((item) => item.id) };
  }).sort((a, b) => (b.messages[0]?.timestamp ?? b.updatedAt.getTime() / 1000) - (a.messages[0]?.timestamp ?? a.updatedAt.getTime() / 1000));
  res.json({ success: true, data });
}));

chatRouter.get('/prospects/:id/messages', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const target = await prisma.prospect.findFirst({ where: { id: Number(req.params.id), brandId }, select: { id: true, phone: true, remoteJid: true } });
  if (!target) throw new HttpError(404, 'Percakapan tidak ditemukan.');
  const prospects = await prisma.prospect.findMany({ where: { brandId }, select: { id: true, phone: true, remoteJid: true } });
  const key = conversationKey({ ...target, name: '' });
  const aliases = prospects.filter((item) => conversationKey({ ...item, name: '' }) === key);
  const ids = aliases.map((item) => item.id);
  const phones = [...new Set(aliases.flatMap((item) => phoneAliases(item.phone)))];
  const remoteJids = [...new Set(aliases.map((item) => item.remoteJid).filter((value): value is string => Boolean(value)))];
  const data = await prisma.chatMessage.findMany({
    where: {
      brandId,
      isDeleted: false,
      OR: [
        { prospectId: { in: ids } },
        ...(phones.length ? [{ phone: { in: phones } }] : []),
        ...(remoteJids.length ? [{ remoteJid: { in: remoteJids } }] : []),
      ],
    },
    orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
  });
  res.json({ success: true, data });
}));

chatRouter.post('/prospects/:id/history-sync', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.body.brandId ? Number(req.body.brandId) : undefined);
  const target = await prisma.prospect.findFirst({ where: { id: Number(req.params.id), brandId }, select: { id: true, phone: true, remoteJid: true } });
  if (!target) throw new HttpError(404, 'Percakapan tidak ditemukan.');
  const prospects = await prisma.prospect.findMany({ where: { brandId }, select: { id: true, phone: true, remoteJid: true } });
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
  if (req.user!.role !== 'cs') throw new HttpError(403, 'Hanya CS yang dapat mengirim pesan jamaah.');
  const input = messageInputSchema.parse(req.body);
  const brandId = scopedBrandId(req);
  const prospect = await prisma.prospect.findFirst({ where: { id: input.prospectId, brandId } });
  if (!prospect) throw new HttpError(404, 'Prospek tidak ditemukan.');
  if (!prospect.phone) throw new HttpError(422, 'Nomor WhatsApp prospek belum tersedia.');
  const phone = prospect.phone;
  const remoteJid = prospect.remoteJid ?? `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
  const gatewayResponse = await fetch(`${env.WA_GATEWAY_URL}/sessions/${brandId}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': env.WA_GATEWAY_SECRET },
    body: JSON.stringify({ jid: remoteJid, text: input.text, quotedMessageId: input.quotedMessageId }),
  }).catch(() => null);
  if (!gatewayResponse?.ok) throw new HttpError(502, 'WhatsApp belum terhubung atau gateway tidak tersedia.');
  const gatewayResult = await gatewayResponse.json() as { data?: { messageId?: string } };
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.chatMessage.create({ data: { brandId, prospectId: prospect.id, messageId: gatewayResult.data?.messageId ?? `local-${randomUUID()}`, remoteJid, phone, senderName: req.user!.name, isFromMe: true, messageText: input.text, messageType: 'conversation', status: 'sent', timestamp: Math.floor(Date.now() / 1000), quotedMessageId: input.quotedMessageId } });
    await tx.prospect.update({ where: { id: prospect.id }, data: { userId: req.user!.id } });
    await tx.prospectLog.create({ data: { prospectId: prospect.id, userId: req.user!.id, actionType: 'message_sent', title: `Pesan dikirim oleh ${req.user!.name}` } });
    return created;
  });
  emitToBrand(brandId, 'message:new', message);
  emitToBrand(brandId, 'prospect:claimed', { prospectId: prospect.id, userId: req.user!.id, userName: req.user!.name });
  res.status(201).json({ success: true, data: message });
}));

chatRouter.get('/wa/status', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const data = await prisma.whatsappSession.findUnique({ where: { brandId } });
  res.json({ success: true, data: data ?? { brandId, status: 'disconnected' } });
}));

export const internalRouter = Router();
internalRouter.use((req, _res, next) => req.get('x-internal-secret') === env.WA_GATEWAY_SECRET ? next() : next(new HttpError(401, 'Internal secret tidak valid.')));

const gatewayMessageSchema = z.object({
  brandId: z.coerce.number().int().positive(),
  messageId: z.string().min(1).max(100),
  remoteJid: z.string().min(3).max(100),
  phone: z.string().min(5).max(30),
  senderName: z.string().max(100).optional(),
  text: z.string().optional().default(''),
  timestamp: z.coerce.number().int().nonnegative(),
  messageType: z.string().max(30).optional().default('conversation'),
  mediaUrl: z.string().max(10_000).optional(),
  isFromMe: z.boolean().optional().default(false),
  referral: z.unknown().optional(),
});

type GatewayMessageInput = z.infer<typeof gatewayMessageSchema>;

async function ingestGatewayMessage(input: GatewayMessageInput, options: { realtime: boolean }) {
  const { brandId, messageId, remoteJid, senderName, text, timestamp, messageType, mediaUrl, isFromMe, referral } = input;
  const phone = normalizePhoneIdentifier(input.phone);
  const referralMarker = normalizeReferralMarker(referral);
  const aliases = phoneAliases(phone);
  const candidates = await prisma.prospect.findMany({ where: { brandId, OR: [{ remoteJid }, { phone: { in: aliases } }] }, select: { id: true, name: true, phone: true, remoteJid: true, packageId: true, userId: true, notes: true, updatedAt: true } });
  let prospect = candidates.length ? chooseCanonicalProspect(candidates) : null;
  let referralCaptured = false;
  if (!prospect) {
    const users = isFromMe ? [] : await prisma.user.findMany({ where: { brandId, role: 'cs', isActive: true }, select: { id: true, _count: { select: { prospects: { where: { status: { notIn: ['closed_won', 'closed_lost'] } } } } } } });
    const assigned = users.sort((a, b) => a._count.prospects - b._count.prospects)[0];
    prospect = await prisma.prospect.create({ data: { brandId, userId: assigned?.id ?? null, name: senderName || phone, phone, remoteJid, leadSource: referralMarker ? 'meta_ads' : 'whatsapp', metaReferralMarker: referralMarker?.ctwaClid, adId: referralMarker?.adId, campaignId: referralMarker?.campaignId, adHeadline: referralMarker?.headline, adSourceUrl: referralMarker?.sourceUrl } });
    referralCaptured = Boolean(referralMarker);
  } else {
    referralCaptured = await attachReferralMarker(prospect.id, referralMarker);
    const shouldUseIncomingJid = !prospect.remoteJid || remoteJid.endsWith('@lid');
    if (!prospect.phone || shouldUseIncomingJid) {
      prospect = await prisma.prospect.update({ where: { id: prospect.id }, data: { ...(!prospect.phone ? { phone } : {}), ...(shouldUseIncomingJid ? { remoteJid } : {}) }, select: { id: true, name: true, phone: true, remoteJid: true, packageId: true, userId: true, notes: true, updatedAt: true } });
    }
  }
  const message = await prisma.chatMessage.upsert({ where: { brandId_messageId: { brandId, messageId } }, update: { prospectId: prospect.id, remoteJid, phone, senderName, isFromMe, messageText: text, messageType, mediaUrl, timestamp: timestamp || Math.floor(Date.now() / 1000), status: 'delivered', metaReferralData: referralMarker ?? undefined }, create: { brandId, prospectId: prospect.id, messageId, remoteJid, phone, senderName, isFromMe, messageText: text, messageType, mediaUrl, timestamp: timestamp || Math.floor(Date.now() / 1000), metaReferralData: referralMarker ?? undefined } });
  if (options.realtime) emitToBrand(brandId, 'message:new', message);
  if (options.realtime && referralCaptured) void dispatchCapiEvent(prospect.id, 'Contact').catch((error) => console.error('CAPI Contact dispatch failed', error));
  return message;
}

internalRouter.post('/messages/incoming', asyncHandler(async (req, res) => {
  const input = gatewayMessageSchema.parse(req.body);
  const message = await ingestGatewayMessage(input, { realtime: true });
  res.status(201).json({ success: true, data: message });
}));

internalRouter.post('/messages/history', asyncHandler(async (req, res) => {
  const input = z.object({ brandId: z.coerce.number().int().positive(), messages: z.array(gatewayMessageSchema).max(100) }).parse(req.body);
  const messages = [];
  for (const item of input.messages) {
    if (item.brandId !== input.brandId) throw new HttpError(400, 'Brand histori pesan tidak konsisten.');
    messages.push(await ingestGatewayMessage(item, { realtime: false }));
  }
  const latest = messages.sort((a, b) => b.timestamp - a.timestamp)[0];
  if (latest) emitToBrand(input.brandId, 'message:new', latest);
  res.status(201).json({ success: true, data: { imported: messages.length } });
}));

const gatewayContactSchema = z.object({
  brandId: z.coerce.number().int().positive(),
  remoteJid: z.string().min(3).max(100),
  phone: z.string().min(5).max(30),
  name: z.string().trim().min(1).max(100).optional(),
});

internalRouter.post('/contacts/sync', asyncHandler(async (req, res) => {
  const input = z.object({
    brandId: z.coerce.number().int().positive(),
    contacts: z.array(gatewayContactSchema).max(100),
  }).parse(req.body);
  let imported = 0;
  for (const contact of input.contacts) {
    if (contact.brandId !== input.brandId) throw new HttpError(400, 'Brand kontak tidak konsisten.');
    const phone = normalizePhoneIdentifier(contact.phone);
    if (!phone) continue;
    const aliases = phoneAliases(phone);
    const candidates = await prisma.prospect.findMany({
      where: { brandId: input.brandId, OR: [{ remoteJid: contact.remoteJid }, { phone: { in: aliases } }] },
      select: { id: true, name: true, phone: true, remoteJid: true, packageId: true, userId: true, notes: true, updatedAt: true },
    });
    const existing = candidates.length ? chooseCanonicalProspect(candidates) : null;
    const displayName = contact.name || phone;
    if (!existing) {
      await prisma.prospect.create({ data: { brandId: input.brandId, name: displayName, phone, remoteJid: contact.remoteJid, leadSource: 'whatsapp' } });
      imported += 1;
      continue;
    }
    const existingNameIsGeneric = /^\+?\d+$/.test(existing.name.trim()) || existing.name.trim() === existing.phone;
    await prisma.prospect.update({
      where: { id: existing.id },
      data: {
        ...(!existing.phone ? { phone } : {}),
        ...((!existing.remoteJid || contact.remoteJid.endsWith('@lid')) ? { remoteJid: contact.remoteJid } : {}),
        ...(existingNameIsGeneric && contact.name ? { name: contact.name } : {}),
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
  }).parse(req.body);
  const qrCode = input.status === 'qr_ready' ? input.qrCode ?? null : null;
  const phoneNumber = input.status === 'connected' ? input.phoneNumber ?? undefined : input.status === 'disconnected' ? null : undefined;
  const session = await prisma.whatsappSession.upsert({
    where: { brandId: input.brandId },
    update: { status: input.status, qrCode, phoneNumber, lastConnectedAt: input.status === 'connected' ? new Date() : undefined },
    create: { brandId: input.brandId, sessionName: `brand_${input.brandId}`, status: input.status, qrCode, phoneNumber: phoneNumber ?? null },
  });
  emitToBrand(input.brandId, input.status === 'qr_ready' ? 'wa:qr' : 'wa:status', session);
  res.json({ success: true, data: session });
}));
