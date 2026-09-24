import { Prisma, type NotificationPriority } from '@prisma/client';
import { effectiveNotificationPreference, type NotificationType } from '@csumroh/shared-types';
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
  const update = { ...data, count: { increment: 1 }, readAt: null };
  try {
    return await prisma.notification.upsert({ where, update, create: { ...data, userId, activeKey: input.activeKey } });
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
export async function notify(input: NotifyInput): Promise<number> {
  if (!env.NOTIFICATIONS_ENABLED) return 0;
  const userIds = [...new Set(input.userIds)].filter((id) => id && id !== input.actorId);
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
 * Tandai notifikasi kondisi sebagai selesai (mis. jamaah sudah dibalas, bukti sudah diverifikasi):
 * keluar dari "Perlu tindakan" dan hitungan belum dibaca, tetapi tetap ada di riwayat.
 */
export async function resolveNotifications(input: { entity: NotificationEntity; types: NotificationType[]; userIds?: number[] }) {
  if (!env.NOTIFICATIONS_ENABLED) return 0;
  try {
    const where: Prisma.NotificationWhereInput = {
      entityType: input.entity.type,
      entityId: input.entity.id,
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
