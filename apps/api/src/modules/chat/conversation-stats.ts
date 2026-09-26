import type { Prisma } from '@prisma/client';
import { firstUnansweredAt } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';

/**
 * Ringkasan percakapan per prospek (pesan terakhir, belum dibaca, sejak kapan jamaah menunggu, nama pengirim,
 * jumlah pesan) disimpan di tabel prospek dan dihitung ulang setiap pesan prospek itu berubah. Daftar Inbox,
 * Pipeline, dashboard tugas, dan job SLA cukup membaca kolom ini, bukan memuat 20 pesan terakhir setiap prospek.
 * Perhitungannya sama persis dengan cara lama (jendela 20 pesan tampil terakhir).
 */
export const HIDDEN_MESSAGE_TYPES = ['protocolMessage', 'reactionMessage'];
const MEDIA_MESSAGE_TYPES = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage', 'contactMessage', 'locationMessage'];
/** Pesan yang tampil di percakapan: tidak dihapus, bukan protokol/reaksi, dan berisi teks atau media. */
export const VISIBLE_MESSAGE: Prisma.ChatMessageWhereInput = {
  isDeleted: false,
  messageType: { notIn: HIDDEN_MESSAGE_TYPES },
  OR: [
    { messageText: { not: '' } },
    { mediaUrl: { not: null } },
    { messageType: { in: MEDIA_MESSAGE_TYPES } },
  ],
};
export const CONVERSATION_WINDOW = 20;

type WindowMessage = { timestamp: number; isFromMe: boolean; status: string; senderName: string | null };

/** Ringkasan dari pesan terurut terbaru dulu (satu prospek, atau gabungan beberapa record kontak yang sama). */
export function summarizeMessages<T extends WindowMessage>(sortedDesc: T[]) {
  let unreadCount = 0;
  for (const message of sortedDesc) {
    if (message.isFromMe) break;
    if (message.status !== 'read') unreadCount++;
  }
  return {
    latest: sortedDesc[0] ?? null,
    unreadCount,
    awaitingSince: firstUnansweredAt(sortedDesc),
    inboundSenderName: sortedDesc.find((m) => m.senderName && !m.isFromMe)?.senderName ?? null,
  };
}

/** Jendela pesan tampil terakhir per prospek (dipakai saat satu kontak tersimpan sebagai beberapa record). */
export async function loadConversationWindows(prospectIds: number[]) {
  const windows = await Promise.all(prospectIds.map((prospectId) => prisma.chatMessage.findMany({
    where: { prospectId, ...VISIBLE_MESSAGE },
    orderBy: { timestamp: 'desc' },
    take: CONVERSATION_WINDOW,
  })));
  return windows.flat().sort((a, b) => b.timestamp - a.timestamp);
}

async function refreshOne(prospectId: number) {
  const [window, messageCount] = await Promise.all([
    prisma.chatMessage.findMany({ where: { prospectId, ...VISIBLE_MESSAGE }, orderBy: { timestamp: 'desc' }, take: CONVERSATION_WINDOW }),
    prisma.chatMessage.count({ where: { prospectId, isDeleted: false, messageType: { notIn: HIDDEN_MESSAGE_TYPES } } }),
  ]);
  const s = summarizeMessages(window);
  // SQL langsung, bukan prisma.prospect.update: @updatedAt tidak boleh bergeser karena pesan (dipakai sebagai
  // versi perubahan data prospek oleh CS, mis. deteksi konflik dan "Diubah CS … lalu").
  await prisma.$executeRaw`
    UPDATE prospects SET
      last_message_at = ${s.latest?.timestamp ?? null},
      last_message = ${s.latest ? JSON.stringify(s.latest) : null},
      unread_count = ${s.unreadCount},
      awaiting_since = ${s.awaitingSince},
      inbound_sender_name = ${s.inboundSenderName},
      message_count = ${messageCount},
      conversation_stats_at = NOW(3)
    WHERE id = ${prospectId}`;
}

export async function refreshConversationStats(prospectIds: Iterable<number>) {
  const ids = [...new Set([...prospectIds].filter((id) => Number.isInteger(id) && id > 0))];
  for (let i = 0; i < ids.length; i += 20) await Promise.all(ids.slice(i, i + 20).map(refreshOne));
}

/**
 * Pesan sering datang beruntun (impor riwayat, status terkirim→diterima→dibaca): perhitungan ulang digabung
 * per 200 ms agar satu prospek tidak dihitung berkali-kali. Kegagalan hanya dicatat; daftar menghitung ulang
 * prospek yang belum punya ringkasan saat dibuka.
 */
const pending = new Set<number>();
let timer: ReturnType<typeof setTimeout> | null = null;
export function scheduleConversationStats(prospectIds: Iterable<number | null | undefined>) {
  for (const id of prospectIds) if (id) pending.add(id);
  if (timer || !pending.size) return;
  timer = setTimeout(() => {
    const ids = [...pending];
    pending.clear();
    timer = null;
    refreshConversationStats(ids).catch((error) => console.error('Gagal memperbarui ringkasan percakapan', error));
  }, 200);
}

/** Prospek yang belum punya ringkasan (data lama sebelum migrasi, atau hasil impor) dihitung dulu. */
export async function ensureConversationStats(brandId?: number) {
  for (;;) {
    const missing = await prisma.prospect.findMany({
      where: { ...(brandId ? { brandId } : {}), conversationStatsAt: null },
      select: { id: true },
      take: 500,
    });
    if (!missing.length) return;
    await refreshConversationStats(missing.map((p) => p.id));
    if (missing.length < 500) return;
  }
}
