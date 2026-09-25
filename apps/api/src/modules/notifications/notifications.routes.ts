import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { effectiveNotificationPreference, notificationTypesForRole } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { authGuard } from '../../middleware/auth.js';
import { emitToUser } from '../../realtime/socket.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { toPayload } from './notify.service.js';

export const notificationsRouter = Router();
notificationsRouter.use(authGuard);

const retiredTypes = ['refund.needed', 'payment.overpaid', 'invoice.overdue_digest'];

// Semua query dibatasi pada penerima = user yang login; tidak ada akses ke notifikasi user lain.
const unreadWhere = (userId: number): Prisma.NotificationWhereInput => ({ userId, readAt: null, resolvedAt: null, type: { notIn: retiredTypes } });

/**
 * Lencana hanya menghitung yang perlu tindakan (tindakan + mendesak). Info (mis. pesan baru, yang juga
 * sudah terlihat sebagai hitungan belum dibaca di Inbox) cukup ditandai titik agar angka tetap bermakna.
 */
async function unreadCount(userId: number) {
  const [actionable, urgent, info] = await Promise.all([
    prisma.notification.count({ where: { ...unreadWhere(userId), priority: { in: ['action', 'urgent'] } } }),
    prisma.notification.count({ where: { ...unreadWhere(userId), priority: 'urgent' } }),
    prisma.notification.count({ where: { ...unreadWhere(userId), priority: 'info' } }),
  ]);
  return { actionable, urgent, info };
}

const ACTION_TAB_LIMIT = 100;

notificationsRouter.get('/', asyncHandler(async (req, res) => {
  const { filter, cursor, limit } = z.object({
    // unread = belum dibaca; action = perlu tindakan (belum dibaca/selesai, prioritas tindakan/mendesak).
    filter: z.enum(['all', 'unread', 'action']).default('all'),
    cursor: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }).parse(req.query);
  const userId = req.user!.id;
  const where: Prisma.NotificationWhereInput = {
    userId, type: { notIn: retiredTypes },
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
  res.json({ success: true, data: await unreadCount(req.user!.id) });
}));

notificationsRouter.post('/read-all', asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const result = await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date(), activeKey: null } });
  emitToUser(userId, 'notification:read', { all: true });
  res.json({ success: true, data: { updated: result.count, unread: await unreadCount(userId) } });
}));

notificationsRouter.post('/:id/read', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const userId = req.user!.id;
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'ID notifikasi tidak valid.');
  // Dibaca = baris ringkasan ditutup (activeKey dikosongkan) agar kejadian berikutnya membuat notifikasi baru.
  const result = await prisma.notification.updateMany({ where: { id, userId }, data: { readAt: new Date(), activeKey: null } });
  if (result.count === 0) throw new HttpError(404, 'Notifikasi tidak ditemukan.');
  emitToUser(userId, 'notification:read', { ids: [id] });
  res.json({ success: true, data: { unread: await unreadCount(userId) } });
}));

// ── Preferensi: toast dan suara per tipe; daftar notifikasi selalu aktif, Mendesak selalu toast ──

async function preferencesFor(userId: number, role: string) {
  const stored = await prisma.notificationPreference.findMany({ where: { userId }, select: { type: true, toast: true, sound: true } });
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
    items: z.array(z.object({ type: z.string().max(50), toast: z.boolean(), sound: z.boolean() })).min(1).max(60),
  }).parse(req.body);
  const userId = req.user!.id;
  const allowed = new Set<string>(notificationTypesForRole(req.user!.role).map((entry) => entry.type));
  const invalid = items.find((item) => !allowed.has(item.type));
  if (invalid) throw new HttpError(422, `Tipe notifikasi ${invalid.type} tidak berlaku untuk peran Anda.`);
  await prisma.$transaction(items.map((item) => {
    // Mendesak tidak bisa dimatikan: toast selalu disimpan aktif.
    const data = { toast: effectiveNotificationPreference(item.type, item).locked ? true : item.toast, sound: item.sound };
    return prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type: item.type } },
      update: data,
      create: { userId, type: item.type, ...data },
    });
  }));
  res.json({ success: true, data: await preferencesFor(userId, req.user!.role) });
}));
