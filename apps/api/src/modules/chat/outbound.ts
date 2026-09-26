import { randomUUID } from 'node:crypto';
import type { SessionUser } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { emitToBrand } from '../../realtime/socket.js';
import { scheduleConversationStats } from './conversation-stats.js';
import { HttpError } from '../../utils/http.js';
import { queueCapiForStatus } from '../capi/capi.service.js';
import { dispatch, notifyPicChange, onWhatsappStatus, resolveReplyNotifications } from '../notifications/notification.events.js';

export function normalizePhoneIdentifier(value?: string | null) {
  if (!value || value.endsWith('@lid') || value.endsWith('@g.us')) return '';
  const digits = value.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') ?? '';
  if (!digits || digits === '0') return '';
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

export type OutboundTextInput = {
  user: SessionUser;
  brandId: number;
  prospectId: number;
  text: string;
  quotedMessageId?: string;
  quotedText?: string;
  quotedSender?: string;
  /** Judul log aktivitas; default "Pesan dikirim oleh …" */
  logTitle?: string;
  /** Dokumen resmi (penawaran/invoice) juga boleh dikirim Finance; chat biasa tidak. */
  allowFinance?: boolean;
};

/**
 * Kirim pesan teks ke prospek lewat gateway WhatsApp dan catat hasilnya.
 * Tidak ada perubahan apa pun di database bila gateway gagal: pemanggil boleh
 * menganggap nilai kembalian (messageId) sebagai bukti pesan benar-benar dikirim.
 */
export async function sendTextToProspect(input: OutboundTextInput) {
  const { user, brandId } = input;
  const prospect = await prisma.prospect.findUnique({
    where: { id: input.prospectId },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!prospect || prospect.brandId !== brandId) throw new HttpError(404, 'Percakapan / Prospek tidak ditemukan.');
  if (!prospect.phone) throw new HttpError(422, 'Nomor WhatsApp prospek belum tersedia.');

  const isAdmin = user.role === 'superadmin' || user.role === 'admin' || (Boolean(input.allowFinance) && user.role === 'finance');
  const isPic = Boolean(prospect.userId && prospect.userId === user.id);
  const isUnassigned = !prospect.userId;

  // Hanya admin dan PIC yang bisa balas chat
  if (!isAdmin && !isPic && !(isUnassigned && user.role === 'cs')) {
    const picInfo = prospect.user?.name ? ` (PIC saat ini: ${prospect.user.name})` : '';
    throw new HttpError(403, `Hanya Admin dan PIC yang dapat membalas chat ini${picInfo}.`);
  }

  const session = await prisma.whatsappSession.findUnique({ where: { brandId } });
  if (session?.status !== 'connected') {
    throw new HttpError(400, 'Perangkat WhatsApp tidak terhubung. Tidak dapat mengirim pesan.');
  }

  const phone = normalizePhoneIdentifier(prospect.phone);
  const isGroup = Boolean(prospect.remoteJid?.endsWith('@g.us'));
  const remoteJid = isGroup
    ? prospect.remoteJid!
    : phone
    ? `${phone}@s.whatsapp.net`
    : (prospect.remoteJid && !prospect.remoteJid.endsWith('@lid') ? prospect.remoteJid : `${phone}@s.whatsapp.net`);

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

  const gatewayResponse = await fetch(`${env.WA_GATEWAY_URL}/sessions/${brandId}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': env.WA_GATEWAY_SECRET },
    body: JSON.stringify({
      jid: remoteJid,
      text: input.text,
      quotedMessageId: input.quotedMessageId,
      quotedText,
      isQuotedFromMe,
    }),
  }).catch(() => null);
  if (!gatewayResponse?.ok) {
    await prisma.whatsappSession.updateMany({
      where: { brandId },
      data: { status: 'disconnected', qrCode: null },
    });
    emitToBrand(brandId, 'whatsapp:status', { brandId, status: 'disconnected' });
    void onWhatsappStatus(brandId, 'disconnected');
    throw new HttpError(502, 'WhatsApp belum terhubung atau gateway tidak tersedia.');
  }
  const gatewayResult = await gatewayResponse.json() as { data?: { messageId?: string } };

  const isNewClaim = !prospect.userId && user.role === 'cs';
  let claimed = false;
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.chatMessage.create({
      data: {
        brandId,
        prospectId: prospect.id,
        messageId: gatewayResult.data?.messageId ?? `local-${randomUUID()}`,
        remoteJid,
        phone,
        senderName: user.name,
        isFromMe: true,
        messageText: input.text,
        messageType: 'conversation',
        status: 'sent',
        timestamp: Math.floor(Date.now() / 1000),
        quotedMessageId: input.quotedMessageId,
        quotedText,
        quotedSender,
      },
    });

    // If prospect is not assigned yet and sender is CS, claim as PIC (conditional: no double claim)
    if (isNewClaim) {
      const result = await tx.prospect.updateMany({ where: { id: prospect.id, userId: null }, data: { userId: user.id } });
      claimed = result.count > 0;
      if (claimed) {
        await tx.prospectLog.create({
          data: { prospectId: prospect.id, userId: user.id, actionType: 'pic_claimed', title: `PIC diklaim oleh ${user.name}` },
        });
      }
    }

    // Auto-promote: new -> contact upon first outbound message
    if (prospect.status === 'new') {
      await tx.prospect.update({ where: { id: prospect.id }, data: { status: 'contact' } });
      await tx.prospectLog.create({
        data: {
          prospectId: prospect.id,
          userId: user.id,
          actionType: 'status_changed',
          title: 'Status otomatis menjadi Terhubung (contact)',
          description: 'Pesan balasan pertama dikirim oleh CS',
        },
      });
    }

    await tx.prospectLog.create({
      data: {
        prospectId: prospect.id,
        userId: user.id,
        actionType: 'message_sent',
        title: input.logTitle ?? `Pesan dikirim oleh ${user.name}`,
      },
    });
    return created;
  });

  // Hanya bila klaim benar-benar menang (CS lain bisa mengklaim lebih dulu di antara pengecekan dan pengiriman).
  if (claimed) {
    emitToBrand(brandId, 'prospect:claimed', { prospectIds: [prospect.id], userId: user.id, userName: user.name });
    dispatch(() => notifyPicChange({
      prospect: { id: prospect.id, brandId, name: prospect.name }, kind: 'claimed', fromUserId: null, toUserId: user.id, actor: user,
    }));
  }
  // Jamaah sudah dibalas: pengingat "pesan baru"/"lead baru" untuk prospek ini selesai.
  dispatch(() => resolveReplyNotifications(prospect.id));
  if (prospect.status === 'new') {
    emitToBrand(brandId, 'prospect:updated', { id: prospect.id, status: 'contact' });
    queueCapiForStatus(prospect.id, 'contact');
  }
  scheduleConversationStats([prospect.id]);
  emitToBrand(brandId, 'message:new', message);
  return message;
}
