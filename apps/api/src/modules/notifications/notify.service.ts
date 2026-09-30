import { Prisma, type NotificationPriority } from '@prisma/client';
import { effectiveNotificationPreference, notificationEntry, type NotificationType } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { emitToUser } from '../../realtime/socket.js';

// Daftar tipe yang sah dan prioritas default ada di katalog shared-types (dipakai juga halaman preferensi).
export type { NotificationType };

export type NotificationEntity = { type: 'prospect' | 'package' | 'brand' | 'system'; id: number };

export type NotifyInput = {
  type: NotificationType;
  priority: NotificationPriority;
  userIds: number[];
  brandId?: number | null;
  /** Pelaku tidak pernah diberi tahu atas tindakannya sendiri. */
  actorId?: number | null;
  title: string;
  body?: string | null;
  link?: string | null;
  entity?: NotificationEntity;
  /** Ringkas kejadian sejenis: satu baris aktif per penerima, `count` bertambah. */
  activeKey?: string;
  /** Kirim sekali saja untuk kunci ini (mis. pesan yang dikirim ulang gateway). */
  dedupeKey?: string;
  /** Ringkasan berbasis keadaan (mis. "12 bukti menunggu"): isi `count` dengan nilai ini, bukan +1 per kejadian. */
  setCount?: number;
};

export type NotificationPayload = {
  id: number;
  type: string;
  priority: NotificationPriority;
  title: string;
  body: string | null;
  link: string | null;
  count: number;
  createdAt: Date;
  /** Keputusan tampilan untuk penerima ini (preferensi); hanya ada pada event realtime. */
  toast?: boolean;
  sound?: boolean;
};

const clip = (value: string | null | undefined, max: number) =>
  value ? (value.length > max ? `${value.slice(0, max - 1)}…` : value) : null;

/** Hanya path internal aplikasi (diawali satu "/"); URL eksternal atau skema lain dibuang. */
export function safeLink(link?: string | null) {
  if (!link || !link.startsWith('/') || link.startsWith('//') || link.includes('\\') || link.length > 300) return null;
  return link;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function writeFor(userId: number, input: NotifyInput) {
  const data = {
    type: input.type,
    priority: input.priority,
    brandId: input.brandId ?? null,
    actorId: input.actorId ?? null,
    title: clip(input.title, 200)!,
    body: clip(input.body, 500),
    link: safeLink(input.link),
    entityType: input.entity?.type ?? null,
    entityId: input.entity?.id ?? null,
  };
  if (!input.activeKey) return prisma.notification.create({ data: { ...data, userId } });

  const where = { userId_activeKey: { userId, activeKey: input.activeKey } };
  const update = { ...data, count: input.setCount ?? { increment: 1 }, readAt: null };
  try {
    return await prisma.notification.upsert({ where, update, create: { ...data, userId, activeKey: input.activeKey, count: input.setCount ?? 1 } });
  } catch (error) {
    // Dua kejadian bersamaan membuat baris yang sama: yang kalah cukup menambah hitungan.
    if (isUniqueViolation(error)) return prisma.notification.update({ where, data: update });
    throw error;
  }
}

/**
 * Simpan notifikasi untuk setiap penerima lalu kirim realtime ke room pribadinya.
 * Tidak pernah melempar error: kegagalan notifikasi tidak boleh menggagalkan tindakan bisnis,
 * sehingga pemanggil boleh memanggilnya setelah transaksi selesai tanpa try/catch.
 */
/** User yang mematikan tipe ini di Pengaturan Notifikasi (tipe Mendesak tidak bisa dimatikan). */
async function withoutMuted(type: string, userIds: number[]) {
  if (!userIds.length || notificationEntry(type)?.priority === 'urgent') return userIds;
  const muted = await prisma.notificationPreference.findMany({ where: { type, muted: true, userId: { in: userIds } }, select: { userId: true } });
  const mutedIds = new Set(muted.map((row) => row.userId));
  return userIds.filter((id) => !mutedIds.has(id));
}

export async function notify(input: NotifyInput): Promise<number> {
  if (!env.NOTIFICATIONS_ENABLED) return 0;
  const recipients = [...new Set(input.userIds)].filter((id) => id && id !== input.actorId);
  // Preferensi tidak terbaca: tetap kirim (lebih baik tidak dimatikan daripada hilang).
  const userIds = await withoutMuted(input.type, recipients).catch(() => recipients);
  if (!userIds.length) return 0;
  try {
    if (input.dedupeKey) {
      try {
        await prisma.notificationDedupe.create({ data: { key: input.dedupeKey.slice(0, 191) } });
      } catch (error) {
        if (isUniqueViolation(error)) return 0;
        throw error;
      }
    }
    let delivered = 0;
    for (const userId of userIds) {
      const row = await writeFor(userId, input);
      delivered++;
      const stored = await prisma.notificationPreference.findUnique({
        where: { userId_type: { userId, type: input.type } },
        select: { toast: true, sound: true },
      });
      const preference = effectiveNotificationPreference(input.type, stored);
      // Prioritas pengirim menang atas default katalog: Mendesak selalu toast.
      const toast = input.priority === 'urgent' || preference.toast;
      emitToUser(userId, 'notification:new', { ...toPayload(row), toast, sound: preference.sound });
    }
    return delivered;
  } catch (error) {
    console.error(`Notifikasi ${input.type} gagal dikirim`, error);
    return 0;
  }
}

/**
 * Ringkasan per brand yang angkanya = kondisi saat ini, bukan tumpukan kejadian. Baris tetap satu per penerima:
 * dibaca tidak menutupnya (lihat notifications.routes), jadi angka yang sama tidak memunculkan notifikasi baru.
 */
export const SUMMARY_TYPES = ['lead.unassigned', 'reply.escalation'] as const satisfies readonly NotificationType[];

export type SummaryInput = {
  type: (typeof SUMMARY_TYPES)[number];
  priority: NotificationPriority;
  brandId: number;
  userIds: number[];
  /** Kunci baris, mis. "lead.unassigned:b2". */
  activeKey: string;
  count: number;
  title: string;
  body?: string | null;
  link?: string | null;
};

/**
 * Samakan baris ringkasan dengan jumlah saat ini. Jumlah naik = belum dibaca lagi dan toast; turun = angka
 * diperbarui diam-diam; 0 = selesai (keluar dari "Perlu tindakan").
 */
export async function syncSummary(input: SummaryInput): Promise<number> {
  if (!env.NOTIFICATIONS_ENABLED) return 0;
  try {
    if (input.count <= 0) {
      const open = await prisma.notification.findMany({ where: { activeKey: input.activeKey, resolvedAt: null }, select: { id: true, userId: true } });
      if (!open.length) return 0;
      await prisma.notification.updateMany({ where: { id: { in: open.map((row) => row.id) } }, data: { resolvedAt: new Date(), activeKey: null } });
      for (const row of open) emitToUser(row.userId, 'notification:updated', { ids: [row.id], resolved: true });
      return 0;
    }
    const userIds = await withoutMuted(input.type, [...new Set(input.userIds)].filter(Boolean));
    let changed = 0;
    for (const userId of userIds) {
      const existing = await prisma.notification.findUnique({ where: { userId_activeKey: { userId, activeKey: input.activeKey } } });
      if (existing && existing.count === input.count && existing.title === clip(input.title, 200)) continue;
      const increased = !existing || input.count > existing.count;
      const data = {
        type: input.type, priority: input.priority, brandId: input.brandId,
        title: clip(input.title, 200)!, body: clip(input.body, 500), link: safeLink(input.link),
        entityType: 'brand', entityId: input.brandId, count: input.count,
      };
      const row = existing
        ? await prisma.notification.update({ where: { id: existing.id }, data: { ...data, ...(increased ? { readAt: null } : {}) } })
        : await prisma.notification.create({ data: { ...data, userId, activeKey: input.activeKey } });
      changed++;
      const stored = await prisma.notificationPreference.findUnique({ where: { userId_type: { userId, type: input.type } }, select: { toast: true, sound: true } });
      const preference = effectiveNotificationPreference(input.type, stored);
      emitToUser(userId, 'notification:new', {
        ...toPayload(row),
        toast: increased && (input.priority === 'urgent' || preference.toast),
        sound: increased && preference.sound,
      });
    }
    return changed;
  } catch (error) {
    console.error(`Ringkasan ${input.type} gagal diperbarui`, error);
    return 0;
  }
}

/**
 * Tandai notifikasi kondisi sebagai selesai (mis. jamaah sudah dibalas, bukti sudah diverifikasi):
 * keluar dari "Perlu tindakan" dan hitungan belum dibaca, tetapi tetap ada di riwayat.
 */
export async function resolveNotifications(input: { entity?: NotificationEntity; types: NotificationType[]; userIds?: number[] }) {
  if (!env.NOTIFICATIONS_ENABLED) return 0;
  try {
    const where: Prisma.NotificationWhereInput = {
      // Tanpa entitas: tutup semua notifikasi aktif bertipe ini (mis. ringkasan antrean yang sudah kosong).
      ...(input.entity ? { entityType: input.entity.type, entityId: input.entity.id } : {}),
      type: { in: input.types },
      resolvedAt: null,
      ...(input.userIds ? { userId: { in: input.userIds } } : {}),
    };
    const rows = await prisma.notification.findMany({ where, select: { id: true, userId: true } });
    if (!rows.length) return 0;
    await prisma.notification.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { resolvedAt: new Date(), activeKey: null } });
    for (const userId of new Set(rows.map((r) => r.userId))) {
      emitToUser(userId, 'notification:updated', { ids: rows.filter((r) => r.userId === userId).map((r) => r.id), resolved: true });
    }
    return rows.length;
  } catch (error) {
    console.error('Gagal menandai notifikasi selesai', error);
    return 0;
  }
}

export function toPayload(row: {
  id: number; type: string; priority: NotificationPriority; title: string; body: string | null;
  link: string | null; count: number; createdAt: Date;
}): NotificationPayload {
  return { id: row.id, type: row.type, priority: row.priority, title: row.title, body: row.body, link: row.link, count: row.count, createdAt: row.createdAt };
}
