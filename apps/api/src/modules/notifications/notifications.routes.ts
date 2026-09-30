import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { effectiveNotificationPreference, notificationTypesForRole } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { authGuard } from '../../middleware/auth.js';
import { emitToUser } from '../../realtime/socket.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { SUMMARY_TYPES, toPayload } from './notify.service.js';

export const notificationsRouter = Router();
notificationsRouter.use(authGuard);

const retiredTypes = ['refund.needed', 'payment.overpaid', 'invoice.overdue_digest'];

// Semua query dibatasi pada penerima = user yang login; tidak ada akses ke notifikasi user lain.
const unreadWhere = (userId: number, brandId?: number): Prisma.NotificationWhereInput => ({
  userId, readAt: null, resolvedAt: null, type: { notIn: retiredTypes }, ...(brandId ? { brandId } : {}),
});
const brandFilter = z.coerce.number().int().positive().optional();

/**
 * Dibaca: baris biasa ditutup (activeKey dikosongkan) agar kejadian berikutnya membuat notifikasi baru. Ringkasan per
 * brand tetap terbuka: angka yang sama tidak muncul lagi, dan angka yang naik menandainya belum dibaca.
 */
async function markRead(where: Prisma.NotificationWhereInput) {
  const readAt = new Date();
  const [plain, summaries] = await Promise.all([
    prisma.notification.updateMany({ where: { ...where, type: { notIn: [...SUMMARY_TYPES] } }, data: { readAt, activeKey: null } }),
    prisma.notification.updateMany({ where: { ...where, type: { in: [...SUMMARY_TYPES] } }, data: { readAt } }),
  ]);
  return plain.count + summaries.count;
}

/**
 * Lencana hanya menghitung yang perlu tindakan (tindakan + mendesak). Info (mis. pesan baru, yang juga
 * sudah terlihat sebagai hitungan belum dibaca di Inbox) cukup ditandai titik agar angka tetap bermakna.
 */
async function unreadCount(userId: number, brandId?: number) {
  const [actionable, urgent, info] = await Promise.all([
    prisma.notification.count({ where: { ...unreadWhere(userId, brandId), priority: { in: ['action', 'urgent'] } } }),
    prisma.notification.count({ where: { ...unreadWhere(userId, brandId), priority: 'urgent' } }),
    prisma.notification.count({ where: { ...unreadWhere(userId, brandId), priority: 'info' } }),
  ]);
  return { actionable, urgent, info };
}

const ACTION_TAB_LIMIT = 100;

notificationsRouter.get('/', asyncHandler(async (req, res) => {
  const { filter, cursor, limit, brandId } = z.object({
    // unread = belum dibaca; action = perlu tindakan (belum dibaca/selesai, prioritas tindakan/mendesak).
    filter: z.enum(['all', 'unread', 'action']).default('all'),
    cursor: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    brandId: brandFilter,
  }).parse(req.query);
  const userId = req.user!.id;
  const where: Prisma.NotificationWhereInput = {
    userId, type: { notIn: retiredTypes },
    ...(brandId ? { brandId } : {}),
    ...(filter === 'unread' ? { readAt: null, resolvedAt: null } : {}),
    ...(filter === 'action' ? { readAt: null, resolvedAt: null, priority: { in: ['action', 'urgent'] } } : {}),
    ...(cursor ? { id: { lt: cursor } } : {}),
  };
  if (filter === 'action') {
    // Daftar kerja: mendesak lebih dulu, lalu terbaru. Hanya berisi yang belum selesai sehingga pendek;
    // diambil sekaligus (tanpa cursor, karena urutannya bukan berdasarkan id).
    const rows = await prisma.notification.findMany({
      where, orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }], take: ACTION_TAB_LIMIT,
    });
    res.json({
      success: true,
      data: { items: rows.map((row) => ({ ...toPayload(row), readAt: row.readAt, resolvedAt: row.resolvedAt, updatedAt: row.updatedAt })), nextCursor: null },
    });
    return;
  }
  const rows = await prisma.notification.findMany({ where, orderBy: { id: 'desc' }, take: limit + 1 });
  const page = rows.slice(0, limit);
  res.json({
    success: true,
    data: {
      items: page.map((row) => ({ ...toPayload(row), readAt: row.readAt, resolvedAt: row.resolvedAt, updatedAt: row.updatedAt })),
      nextCursor: rows.length > limit ? page.at(-1)!.id : null,
    },
  });
}));

notificationsRouter.get('/unread-count', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await unreadCount(req.user!.id, brandFilter.parse(req.query.brandId)) });
}));

/** Brand yang punya notifikasi untuk user ini, dengan jumlah perlu tindakan: pilihan filter di lonceng. */
notificationsRouter.get('/brands', asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const [all, actionable] = await Promise.all([
    prisma.notification.groupBy({ by: ['brandId'], where: { userId, brandId: { not: null }, type: { notIn: retiredTypes } }, _count: { _all: true } }),
    prisma.notification.groupBy({ by: ['brandId'], where: { ...unreadWhere(userId), brandId: { not: null }, priority: { in: ['action', 'urgent'] } }, _count: { _all: true } }),
  ]);
  const ids = all.map((row) => row.brandId!).filter(Boolean);
  const brands = await prisma.brand.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } });
  res.json({
    success: true,
    data: brands.map((brand) => ({ ...brand, actionable: actionable.find((row) => row.brandId === brand.id)?._count._all ?? 0 })),
  });
}));

notificationsRouter.post('/read-all', asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  // Dengan filter brand: hanya notifikasi brand itu yang ditandai dibaca.
  const brandId = brandFilter.parse(req.query.brandId ?? req.body?.brandId);
  const updated = await markRead({ userId, readAt: null, ...(brandId ? { brandId } : {}) });
  emitToUser(userId, 'notification:read', { all: true });
  res.json({ success: true, data: { updated, unread: await unreadCount(userId) } });
}));

notificationsRouter.post('/:id/read', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const userId = req.user!.id;
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'ID notifikasi tidak valid.');
  if ((await markRead({ id, userId })) === 0) throw new HttpError(404, 'Notifikasi tidak ditemukan.');
  emitToUser(userId, 'notification:read', { ids: [id] });
  res.json({ success: true, data: { unread: await unreadCount(userId) } });
}));

// ── Preferensi: toast, suara, dan matikan per tipe; Mendesak selalu toast dan tidak bisa dimatikan ──

async function preferencesFor(userId: number, role: string) {
  const stored = await prisma.notificationPreference.findMany({ where: { userId }, select: { type: true, toast: true, sound: true, muted: true } });
  const byType = new Map(stored.map((p) => [p.type, p]));
  return notificationTypesForRole(role).map((entry) => ({
    type: entry.type,
    group: entry.group,
    label: entry.label,
    description: entry.description,
    priority: entry.priority,
    ...effectiveNotificationPreference(entry.type, byType.get(entry.type)),
  }));
}

notificationsRouter.get('/preferences', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await preferencesFor(req.user!.id, req.user!.role) });
}));

notificationsRouter.put('/preferences', asyncHandler(async (req, res) => {
  const { items } = z.object({
    items: z.array(z.object({ type: z.string().max(50), toast: z.boolean(), sound: z.boolean(), muted: z.boolean().optional() })).min(1).max(60),
  }).parse(req.body);
  const userId = req.user!.id;
  const allowed = new Set<string>(notificationTypesForRole(req.user!.role).map((entry) => entry.type));
  const invalid = items.find((item) => !allowed.has(item.type));
  if (invalid) throw new HttpError(422, `Tipe notifikasi ${invalid.type} tidak berlaku untuk peran Anda.`);
  await prisma.$transaction(items.map((item) => {
    // Mendesak tidak bisa dimatikan: toast selalu aktif dan tidak pernah muted.
    const locked = effectiveNotificationPreference(item.type, item).locked;
    // muted tidak dikirim = tidak diubah.
    const data = { toast: locked ? true : item.toast, sound: item.sound, ...(locked ? { muted: false } : item.muted !== undefined ? { muted: item.muted } : {}) };
    return prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type: item.type } },
      update: data,
      create: { userId, type: item.type, ...data },
    });
  }));
  res.json({ success: true, data: await preferencesFor(userId, req.user!.role) });
}));
