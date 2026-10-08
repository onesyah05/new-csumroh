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
  // Nomor WhatsApp selalu format internasional. Jangan menambah 62 di depan angka 8: itu mengubah nomor Hong Kong
  // (852…), Korea (82…), Jepang (81…), Taiwan (886…) menjadi nomor Indonesia milik orang lain.
  return digits;
}

/**
 * Nomor device yang akan mengirim pesan. Kontak milik nomor brand lain tidak boleh dibalas dari device yang sedang
 * aktif: jamaah akan menerima pesan dari nomor yang tidak pernah ia hubungi, dan riwayatnya tercampur.
 */
export function sendingDevicePhone(prospect: { devicePhone: string | null }, session: { phoneNumber: string | null } | null) {
  const devicePhone = normalizePhoneIdentifier(session?.phoneNumber);
  if (prospect.devicePhone && devicePhone && prospect.devicePhone !== devicePhone) {
    throw new HttpError(409, `Kontak ini milik nomor WhatsApp +${prospect.devicePhone}. Sambungkan nomor itu untuk membalasnya.`);
  }
  return devicePhone || prospect.devicePhone || null;
}

/**
 * JID tujuan kirim: grup apa adanya, nomor HP bila ada, selain itu ID @lid (kontak yang nomornya disembunyikan
 * WhatsApp; gateway memetakannya ke nomor bila sudah tahu).
 */
export function prospectChatJid(prospect: { phone: string | null; remoteJid: string | null }) {
  if (prospect.remoteJid?.endsWith('@g.us')) return prospect.remoteJid;
  const phone = normalizePhoneIdentifier(prospect.phone) || normalizePhoneIdentifier(prospect.remoteJid);
  if (phone) return `${phone}@s.whatsapp.net`;
  if (prospect.remoteJid?.endsWith('@lid')) return prospect.remoteJid;
  return null;
}

/**
 * Error untuk kiriman yang ditolak gateway. Sesi hanya ditandai putus bila gateway tidak terjangkau atau
 * melaporkan sesi tidak tersambung (409); kegagalan satu pesan (mis. nomor tidak valid) tidak memutus semua user.
 */
export async function gatewayFailure(brandId: number, response: Response | null, message: string) {
  // 409 = gateway hidup tetapi sesi WhatsApp sedang (menyambung ulang) belum terbuka. Status sesi sudah dilaporkan
  // gateway sendiri; menandainya "Terputus" di sini membuat Inbox kosong untuk putus beberapa detik.
  if (response?.status === 409) {
    return new HttpError(503, 'WhatsApp sedang menyambung ulang. Coba kirim lagi dalam beberapa detik.');
  }
  if (!response) {
    await prisma.whatsappSession.updateMany({ where: { brandId }, data: { status: 'disconnected', qrCode: null, disconnectReason: 'gateway_unreachable' } });
    emitToBrand(brandId, 'whatsapp:status', { brandId, status: 'disconnected' });
    void onWhatsappStatus(brandId, 'disconnected');
    return new HttpError(502, 'WhatsApp belum terhubung atau gateway tidak tersedia.');
  }
  console.warn('WhatsApp gateway menolak kiriman', brandId, response.status, await response.text().catch(() => ''));
  return new HttpError(502, message);
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
export type QuoteInput = { quotedMessageId?: string; quotedText?: string; quotedSender?: string };

/**
 * Kutipan balasan hanya sah untuk pesan di chat prospek yang sama. Tanpa cek ini, kutipan yang tertinggal dari chat
 * lain mengirim isi chat jamaah A (nama, nomor, info pembayaran) ke jamaah B. Pesan yang tidak cocok: kutipan dibuang,
 * pesannya tetap terkirim tanpa kutipan.
 */
export async function resolveQuote(
  brandId: number,
  prospect: { id: number; name: string; phone: string | null; remoteJid: string | null },
  input: QuoteInput,
) {
  if (!input.quotedMessageId) return {};
  const quoted = await prisma.chatMessage.findFirst({
    where: { brandId, messageId: input.quotedMessageId },
    select: { prospectId: true, remoteJid: true, phone: true, messageText: true, senderName: true, isFromMe: true },
  });
  if (!quoted) return {};
  const prospectPhone = normalizePhoneIdentifier(prospect.phone);
  const sameChat = quoted.prospectId === prospect.id
    || (Boolean(prospect.remoteJid) && quoted.remoteJid === prospect.remoteJid)
    || (Boolean(prospectPhone) && normalizePhoneIdentifier(quoted.phone) === prospectPhone);
  if (!sameChat) return {};
  return {
    quotedMessageId: input.quotedMessageId,
    quotedText: input.quotedText || quoted.messageText || '',
    quotedSender: input.quotedSender || (quoted.isFromMe ? 'Anda' : (quoted.senderName || prospect.name || 'Jamaah')),
    isQuotedFromMe: quoted.isFromMe,
  };
}

export async function sendTextToProspect(input: OutboundTextInput) {
  const { user, brandId } = input;
  const prospect = await prisma.prospect.findUnique({
    where: { id: input.prospectId },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!prospect || prospect.brandId !== brandId) throw new HttpError(404, 'Percakapan / Prospek tidak ditemukan.');
  const remoteJid = prospectChatJid(prospect);
  if (!remoteJid) throw new HttpError(422, 'Nomor WhatsApp prospek belum tersedia.');

  const isAdmin = user.role === 'superadmin' || user.role === 'admin' || (Boolean(input.allowFinance) && user.role === 'finance');
  const isPic = Boolean(prospect.userId && prospect.userId === user.id);
  const isUnassigned = !prospect.userId;

  // Hanya admin dan PIC yang bisa balas chat
  if (!isAdmin && !isPic && !(isUnassigned && user.role === 'cs')) {
    const picInfo = prospect.user?.name ? ` (PIC saat ini: ${prospect.user.name})` : '';
    throw new HttpError(403, `Hanya Admin dan PIC yang dapat membalas chat ini${picInfo}.`);
  }

  const session = await prisma.whatsappSession.findUnique({ where: { brandId } });
  // Status di database bisa tertinggal (probe yang lambat); gateway yang memutuskan, dan menjawab 409 bila memang putus.
  const devicePhone = sendingDevicePhone(prospect, session);

  const phone = normalizePhoneIdentifier(prospect.phone);

  const { quotedMessageId, quotedText, quotedSender, isQuotedFromMe } = await resolveQuote(brandId, prospect, input);

  const gatewayResponse = await fetch(`${env.WA_GATEWAY_URL}/sessions/${brandId}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': env.WA_GATEWAY_SECRET },
    body: JSON.stringify({
      jid: remoteJid,
      text: input.text,
      quotedMessageId,
      quotedText,
      isQuotedFromMe,
    }),
  }).catch(() => null);
  if (!gatewayResponse?.ok) throw await gatewayFailure(brandId, gatewayResponse, 'WhatsApp menolak pesan ini. Coba lagi.');
  const gatewayResult = await gatewayResponse.json() as { data?: { messageId?: string } };

  const isNewClaim = !prospect.userId && user.role === 'cs';
  let claimed = false;
  const message = await prisma.$transaction(async (tx) => {
    // Upsert: gema pesan dari gateway bisa tersimpan lebih dulu; create biasa gagal P2002 padahal pesan terkirim.
    const messageId = gatewayResult.data?.messageId ?? `local-${randomUUID()}`;
    const created = await tx.chatMessage.upsert({
      where: { brandId_messageId: { brandId, messageId } },
      update: {
        prospectId: prospect.id,
        devicePhone,
        senderName: user.name,
        messageText: input.text,
        quotedMessageId,
        quotedText,
        quotedSender,
      },
      create: {
        brandId,
        prospectId: prospect.id,
        messageId,
        remoteJid,
        phone,
        devicePhone,
        senderName: user.name,
        isFromMe: true,
        messageText: input.text,
        messageType: 'conversation',
        status: 'sent',
        timestamp: Math.floor(Date.now() / 1000),
        quotedMessageId,
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
