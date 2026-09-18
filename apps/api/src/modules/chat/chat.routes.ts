import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { messageInputSchema } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { authGuard, scopedBrandId } from '../../middleware/auth.js';
import { emitToBrand } from '../../realtime/socket.js';
import { asyncHandler, HttpError } from '../../utils/http.js';

export const chatRouter = Router();
chatRouter.use(authGuard);

chatRouter.get('/conversations', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const data = await prisma.prospect.findMany({ where: { brandId }, select: { id: true, name: true, phone: true, photoUrl: true, status: true, remoteJid: true, packageId: true, updatedAt: true, user: { select: { id: true, name: true } }, package: { select: { id: true, name: true } }, messages: { where: { isDeleted: false }, orderBy: { timestamp: 'desc' }, take: 1 } }, orderBy: { updatedAt: 'desc' } });
  res.json({ success: true, data });
}));

chatRouter.get('/prospects/:id/messages', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const exists = await prisma.prospect.count({ where: { id: Number(req.params.id), brandId } });
  if (!exists) throw new HttpError(404, 'Percakapan tidak ditemukan.');
  const data = await prisma.chatMessage.findMany({ where: { prospectId: Number(req.params.id), brandId, isDeleted: false }, orderBy: { timestamp: 'asc' }, take: 300 });
  res.json({ success: true, data });
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

internalRouter.post('/messages/incoming', asyncHandler(async (req, res) => {
  const { brandId, messageId, remoteJid, phone, senderName, text, timestamp, messageType, mediaUrl, referral } = req.body as Record<string, any>;
  if (!brandId || !messageId || !remoteJid || !phone) throw new HttpError(400, 'Payload pesan tidak lengkap.');
  let prospect = await prisma.prospect.findFirst({ where: { brandId: Number(brandId), OR: [{ remoteJid }, { phone }] } });
  if (!prospect) {
    const users = await prisma.user.findMany({ where: { brandId: Number(brandId), role: 'cs', isActive: true }, select: { id: true, _count: { select: { prospects: { where: { status: { notIn: ['closed_won', 'closed_lost'] } } } } } } });
    const assigned = users.sort((a, b) => a._count.prospects - b._count.prospects)[0];
    prospect = await prisma.prospect.create({ data: { brandId: Number(brandId), userId: assigned?.id ?? null, name: senderName || phone, phone, remoteJid, leadSource: referral ? 'meta_ads' : 'whatsapp', metaReferralMarker: referral ? JSON.stringify(referral) : null, adId: referral?.adId, campaignId: referral?.campaignId } });
  }
  const message = await prisma.chatMessage.upsert({ where: { brandId_messageId: { brandId: Number(brandId), messageId } }, update: { status: 'delivered' }, create: { brandId: Number(brandId), prospectId: prospect.id, messageId, remoteJid, phone, senderName, isFromMe: false, messageText: text, messageType: messageType ?? 'conversation', mediaUrl, timestamp: Number(timestamp) || Math.floor(Date.now() / 1000), metaReferralData: referral } });
  emitToBrand(Number(brandId), 'message:new', message);
  res.status(201).json({ success: true, data: message });
}));

internalRouter.post('/wa/status', asyncHandler(async (req, res) => {
  const { brandId, status, qrCode, phoneNumber } = req.body;
  const session = await prisma.whatsappSession.upsert({ where: { brandId: Number(brandId) }, update: { status, qrCode, phoneNumber, lastConnectedAt: status === 'connected' ? new Date() : undefined }, create: { brandId: Number(brandId), sessionName: `brand_${brandId}`, status, qrCode, phoneNumber } });
  emitToBrand(Number(brandId), status === 'qr_ready' ? 'wa:qr' : 'wa:status', session);
  res.json({ success: true, data: session });
}));
