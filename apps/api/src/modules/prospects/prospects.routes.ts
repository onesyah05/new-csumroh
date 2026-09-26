import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { Prisma, ProspectStatus as DbProspectStatus, PaymentStatus } from '@prisma/client';
import {
  businessDateKey,
  canTransitionStatus,
  firstUnansweredAt,
  PIC_TAKEOVER_AFTER_MINUTES,
  takeoverOpensAt,
  dateOnlyKey,
  isLostStatus,
  isWonStatus,
  packageBookingValue,
  prospectInputSchema,
  prospectProfileSchema,
  seatCountFor,
  settlementFields,
  statusUpdateSchema,
  offerInputSchema,
  invoiceInputSchema,
  objectionInputSchema,
  paymentVerifySchema,
  paymentProofSchema,
  PAYMENT_PROOF_PATH_PREFIX,
  BUDGET_OPTIONS,
  DECISION_MAKER_OPTIONS,
  PASSPORT_OPTIONS,
  QUALIFIED_ONWARD,
  TARGET_SEASONS,
  isQualificationComplete,
  parseTargetMonth,
  targetMonthLabel,
  primaryRoomOf,
  qualificationMissing,
  type ProspectStatus,
} from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { authGuard, scopedBrandId } from '../../middleware/auth.js';
import { emitToBrand } from '../../realtime/socket.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { queueCapiForStatus } from '../capi/capi.service.js';
import { getLivechatConversationsForBrand } from '../chat/chat.routes.js';
import { normalizePhoneIdentifier, sendTextToProspect } from '../chat/outbound.js';
import { detectProofType, resolveChatMediaFile } from '../../utils/safe-path.js';
import { env } from '../../config/env.js';
import {
  dispatch,
  notifyBookingCancelled,
  notifyPaymentVerified,
  notifyPicChange,
  notifyProofRejected,
  notifyProofSubmitted,
  closeCustomNotifications,
  notifyCustomDeal,
  notifyQuotaAfterBooking,
} from '../notifications/notification.events.js';
import { assertCanActOnProspect, isClosedStatus, isManager, linkedProspectIds, picCandidates } from './pic.js';
import { describeProfileChanges } from './history.js';
import { activeCustomFor, assertAgreedCustom } from '../custom/custom.service.js';

export const prospectsRouter = Router();
prospectsRouter.use(authGuard);

const include = {
  user: { select: { id: true, name: true } },
  // Harga katalog dipakai untuk menandai penawaran yang perlu dikirim ulang (jamaah/paket berubah).
  package: { select: { id: true, name: true, departureDate: true, price: true, priceQuad: true, priceTriple: true, priceDouble: true, priceInfant: true } },
} as const;

const WON_STATUSES: DbProspectStatus[] = ['deal', 'closed_won'];
const FINANCE_ROLES = ['finance', 'admin', 'superadmin'];
const PROOFS_DIR = () => path.resolve(process.cwd(), 'storage', 'private', 'proofs');

function requestedBrandId(req: Request) {
  const raw = req.body?.brandId ?? req.query?.brandId;
  return raw ? Number(raw) : undefined;
}

/**
 * Brand scope untuk tindakan pada satu prospek. Tanpa brandId eksplisit, scope mengikuti
 * brand milik prospek tersebut lalu divalidasi terhadap hak akses user (UserBrand/holding),
 * sehingga CS multi-brand dapat membuka & menyimpan prospek brand keduanya.
 */
async function resolveProspectBrand(req: Request, id: number) {
  const requested = requestedBrandId(req);
  if (requested) return scopedBrandId(req, requested);
  const row = await prisma.prospect.findFirst({ where: { id }, select: { brandId: true } });
  if (!row) throw new HttpError(404, 'Prospek tidak ditemukan.');
  return scopedBrandId(req, row.brandId);
}

async function findScopedProspect(req: Request) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'ID prospek tidak valid.');
  const brandId = await resolveProspectBrand(req, id);
  const existing = await prisma.prospect.findFirst({ where: { id, brandId } });
  if (!existing) throw new HttpError(404, 'Prospek tidak ditemukan.');
  return { id, brandId, existing };
}

function sameSettlementValue(field: (typeof settlementFields)[number], incoming: unknown, current: unknown) {
  if (incoming === null || incoming === undefined || incoming === '') {
    return current === null || current === undefined || Number(current) === 0;
  }
  if (field === 'paymentStatus') return String(incoming) === String(current);
  if (field === 'dpPaidAt') {
    const a = new Date(String(incoming)).getTime();
    const b = current ? new Date(current as Date).getTime() : NaN;
    return a === b;
  }
  return Number(incoming) === Number(current);
}

prospectsRouter.get('/', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const search = String(req.query.search ?? '').trim().toLowerCase();
  const status = req.query.status ? String(req.query.status) : undefined;
  const filter = req.query.filter ? String(req.query.filter) : undefined;

  // STRICT RULE: Data pipeline HANYA menampilkan kontak yang ada di live chat WA
  const livechatList = await getLivechatConversationsForBrand(brandId, { requireConnected: false });
  let prospects = livechatList.filter((c) => !c.isOwn && c.remoteJid !== '0@s.whatsapp.net');

  if (status) {
    prospects = prospects.filter((p) => p.status === status);
  }
  // Tanggal follow-up adalah kolom DATE; dibandingkan dengan tanggal bisnis WIB hari ini.
  const today = businessDateKey();
  const isOpen = (p: { status: string }) => !isWonStatus(p.status) && !isLostStatus(p.status);
  if (filter === 'unassigned') {
    prospects = prospects.filter((p) => !p.userId && isOpen(p));
  } else if (filter === 'overdue') {
    prospects = prospects.filter((p) => {
      const due = dateOnlyKey(p.nextFollowupDate);
      return due !== null && due < today && isOpen(p);
    });
  } else if (filter === 'today') {
    prospects = prospects.filter((p) => dateOnlyKey(p.nextFollowupDate) === today && isOpen(p));
  }
  if (search) {
    prospects = prospects.filter((p) =>
      `${p.name ?? ''} ${p.phone ?? ''} ${p.city ?? ''}`.toLowerCase().includes(search)
    );
  }

  // Lazy fetch profile pictures in background for pipeline prospects missing photoUrl
  const missing = prospects.filter((item) => !item.photoUrl && !item.isGroup && item.remoteJid && item.remoteJid !== '0@s.whatsapp.net');
  if (missing.length > 0) {
    setImmediate(async () => {
      for (const item of missing.slice(0, 10)) {
        try {
          const params = new URLSearchParams();
          if (item.remoteJid) params.set('jid', item.remoteJid);
          if (item.phone) params.set('phone', item.phone);
          const response = await fetch(`${env.WA_GATEWAY_URL}/sessions/${brandId}/profile-pic?${params.toString()}`, {
            headers: { 'x-internal-secret': env.WA_GATEWAY_SECRET },
          });
          if (response.ok) {
            const body = await response.json() as { success: boolean; data?: { url?: string | null } };
            if (body.data?.url) {
              await prisma.prospect.updateMany({
                where: { brandId, id: { in: [item.id, ...(item.duplicateIds || [])] } },
                data: { photoUrl: body.data.url },
              });
            }
          }
        } catch {}
      }
    });
  }

  res.json({ success: true, data: prospects });
}));

prospectsRouter.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const brandId = await resolveProspectBrand(req, id);
  const prospect = await prisma.prospect.findFirst({
    where: { id, brandId },
    include: {
      ...include,
      brand: {
        select: {
          id: true,
          name: true,
          code: true,
          ppiuNumber: true,
          bankName: true,
          bankAccountNumber: true,
          bankAccountHolder: true,
          address: true,
          phone: true,
        },
      },
      // Pesan & log sengaja tidak dimuat di sini: web mengambilnya lewat /chat/prospects/:id/messages (berhalaman)
      // dan /prospects/:id/logs. Dulu seluruh riwayat ikut termuat (≈900 KB untuk 1.700 pesan) tanpa dipakai.
      customRequests: { where: { status: { not: 'cancelled' } }, orderBy: { id: 'desc' }, take: 1, select: { id: true, status: true, quoteValidUntil: true } },
      payments: {
        select: {
          id: true, amount: true, bankName: true, referenceNo: true, mutationDate: true, status: true, notes: true, proofUrl: true,
          verifiedByUserId: true, correctedAt: true, reversedAt: true, reversalReason: true, createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
      // Alasan penolakan terakhir untuk CS (ditampilkan selama belum ada bukti baru).
      proofRejections: {
        where: { kind: 'rejected' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { reason: true, createdAt: true, rejectedBy: { select: { name: true } } },
      },
    },
  });
  if (!prospect) throw new HttpError(404, 'Prospek tidak ditemukan.');
  res.json({ success: true, data: prospect });
}));

prospectsRouter.post('/', asyncHandler(async (req, res) => {
  const input = prospectInputSchema.parse(req.body);
  const brandId = scopedBrandId(req, req.body.brandId ? Number(req.body.brandId) : undefined);
  const prospect = await prisma.prospect.create({
    data: {
      brandId,
      userId: req.user?.role === 'cs' ? req.user.id : null,
      name: input.name,
      phone: input.phone,
      city: input.city,
      leadSource: input.leadSource,
      packageId: input.packageId,
      notes: input.notes,
      nextFollowupDate: input.nextFollowupDate ? new Date(input.nextFollowupDate) : null,
    },
    include,
  });
  await prisma.prospectLog.create({
    data: { prospectId: prospect.id, userId: req.user!.id, actionType: 'created', title: 'Prospek dibuat' },
  });
  emitToBrand(brandId, 'prospect:updated', prospect);
  res.status(201).json({ success: true, data: prospect });
}));

prospectsRouter.patch('/:id/status', asyncHandler(async (req, res) => {
  const { status, lostReason } = statusUpdateSchema.parse(req.body);
  const { brandId, existing } = await findScopedProspect(req);

  const isLose = isLostStatus(status);

  // Rule: Deal stage can only be set via formal verify-payment route
  if (isWonStatus(status) && !isWonStatus(existing.status)) {
    throw new HttpError(403, 'Tahap Deal hanya dapat disahkan melalui verifikasi pembayaran resmi oleh tim Finance.');
  }

  // Rule: Setting to lose requires lostReason
  if (isLose && !lostReason?.trim()) {
    throw new HttpError(422, 'Alasan pembatalan wajib diisi.');
  }

  if (!canTransitionStatus(existing.status as ProspectStatus, status)) {
    throw new HttpError(422, `Booking yang sudah Deal tidak dapat dipindah ke ${status}. Gunakan pembatalan (lose) bila booking batal.`);
  }

  const isCancellingDeal = isLose && isWonStatus(existing.status);
  if (isCancellingDeal && !isManager(req.user!.role)) {
    throw new HttpError(403, 'Pembatalan Deal hanya dapat dilakukan Admin.');
  }
  await assertCanActOnProspect(req.user!, existing);

  // Action-driven pipeline validation: enforce criteria for each stage transition
  if (status === 'contact') {
    const outboundCount = await prisma.chatMessage.count({
      where: { prospectId: existing.id, isFromMe: true },
    });
    if (outboundCount === 0) {
      throw new HttpError(422, 'Tahap Kontak dicapai otomatis setelah CS mengirimkan minimal 1 pesan balasan ke prospek.');
    }
  }

  if (status === 'qualified' && !isQualificationComplete(existing)) {
    throw new HttpError(422, `Tahap Terkualifikasi memerlukan: ${qualificationMissing(existing).join(', ')}.`);
  }

  if (status === 'offer' && !existing.offerSentAt) {
    throw new HttpError(422, 'Tahap Penawaran (Offer) hanya dapat diaktifkan melalui fitur "Kirim Penawaran Resmi".');
  }

  if (status === 'closing' && !existing.invoiceSentAt) {
    throw new HttpError(422, 'Tahap Closing hanya dapat diaktifkan setelah Invoice DP benar-benar terkirim ke jamaah.');
  }

  const isNewLost = isLose && !isLostStatus(existing.status);

  const { prospect, seatsReleased, customCancelled } = await prisma.$transaction(async (tx) => {
    let released = 0;
    if (isCancellingDeal) {
      // Conditional: only the request that actually flips deal -> lose releases seats.
      const flipped = await tx.prospect.updateMany({
        where: { id: existing.id, status: { in: WON_STATUSES } },
        data: { status: status as DbProspectStatus, seatsReserved: 0, ...(lostReason ? { lostReason } : {}) },
      });
      if (flipped.count === 1 && existing.packageId && existing.seatsReserved > 0) {
        await tx.package.updateMany({
          where: { id: existing.packageId, quotaRemaining: { not: null } },
          data: { quotaRemaining: { increment: existing.seatsReserved } },
        });
        released = existing.seatsReserved;
      }
    }
    const updated = await tx.prospect.update({
      where: { id: existing.id },
      data: {
        status: status as DbProspectStatus,
        ...(isNewLost && lostReason ? { lostReason } : {}),
      },
      include,
    });
    // Prospek batal: permintaan layanan custom yang masih berjalan tidak lagi dihitung Tim LA.
    const customCancelled = isNewLost
      ? (await tx.customRequest.updateMany({ where: { prospectId: existing.id, status: { not: 'cancelled' } }, data: { status: 'cancelled' } })).count
      : 0;
    await tx.prospectLog.create({
      data: {
        prospectId: existing.id,
        userId: req.user!.id,
        actionType: isCancellingDeal ? 'booking_cancelled' : 'status_changed',
        title: isCancellingDeal ? 'Booking Deal dibatalkan' : `Status menjadi ${status}`,
        description: [
          isNewLost && lostReason ? `Dari ${existing.status} — Alasan: ${lostReason}` : `Dari ${existing.status}`,
          released > 0 ? `Seat dikembalikan ke kuota: ${released}` : null,
          customCancelled > 0 ? 'Layanan custom ikut dibatalkan' : null,
        ].filter(Boolean).join(' · '),
      },
    });
    return { prospect: updated, seatsReleased: released, customCancelled };
  });

  emitToBrand(brandId, 'prospect:updated', prospect);
  if (seatsReleased > 0 && existing.packageId) {
    emitToBrand(brandId, 'package:quota_updated', { packageId: existing.packageId });
  }
  if (isCancellingDeal) {
    dispatch(() => notifyBookingCancelled({
      prospect: { id: existing.id, brandId, name: existing.name, userId: existing.userId },
      actor: req.user!, reason: lostReason,
    }));
  }
  if (customCancelled > 0) dispatch(() => closeCustomNotifications({ id: existing.id, brandId, name: existing.name }));
  if (existing.status !== status) queueCapiForStatus(prospect.id, status);
  res.json({ success: true, data: prospect });
}));

prospectsRouter.post('/:id/claim', asyncHandler(async (req, res) => {
  if (req.user!.role !== 'cs') throw new HttpError(403, 'Hanya CS yang dapat menjadi PIC.');
  const { id, brandId, existing } = await findScopedProspect(req);
  if (isClosedStatus(existing.status)) {
    throw new HttpError(409, 'Prospek sudah Deal atau Batal; PIC hanya dapat ditetapkan oleh Admin.');
  }
  const linked = await linkedProspectIds(prisma, existing);
  await prisma.$transaction(async (tx) => {
    // Bersyarat: hanya klaim pertama yang menang; record duplikat nomor yang sama ikut ke PIC ini.
    const result = await tx.prospect.updateMany({ where: { id, brandId, userId: null }, data: { userId: req.user!.id } });
    if (result.count === 0) throw new HttpError(409, 'Prospek sudah diklaim CS lain.');
    await tx.prospect.updateMany({ where: { id: { in: linked }, brandId }, data: { userId: req.user!.id } });
    await tx.prospectLog.create({
      data: { prospectId: id, userId: req.user!.id, actionType: 'pic_claimed', title: `PIC diklaim oleh ${req.user!.name}` },
    });
  });
  const prospect = await prisma.prospect.findUniqueOrThrow({ where: { id }, include });
  emitToBrand(brandId, 'prospect:claimed', { prospectIds: linked, userId: req.user!.id, userName: req.user!.name });
  dispatch(() => notifyPicChange({
    prospect: { id, brandId, name: existing.name }, kind: 'claimed', fromUserId: null, toUserId: req.user!.id, actor: req.user!,
  }));
  res.json({ success: true, data: prospect });
}));

// Daftar CS yang dapat menjadi PIC beserta jumlah prospek terbukanya (untuk Tugaskan PIC dan Serahkan).
prospectsRouter.get('/:id/pic-candidates', asyncHandler(async (req, res) => {
  const { brandId, existing } = await findScopedProspect(req);
  if (!isManager(req.user!.role) && existing.userId !== req.user!.id) {
    throw new HttpError(403, 'Hanya PIC saat ini atau Admin yang dapat melihat daftar CS pengganti.');
  }
  res.json({ success: true, data: await picCandidates(brandId) });
}));

/** Target PIC harus aktif, CS, dan punya akses ke brand prospek (brand utama atau UserBrand). */
async function findEligiblePic(targetUserId: number, brandId: number) {
  return prisma.user.findFirst({
    where: {
      id: targetUserId,
      isActive: true,
      role: 'cs',
      OR: [{ brandId }, { userBrands: { some: { brandId } } }],
    },
  });
}

// Supervisor / Admin Assign PIC (A08)
prospectsRouter.post('/:id/assign', asyncHandler(async (req, res) => {
  if (req.user!.role !== 'admin' && req.user!.role !== 'superadmin') {
    throw new HttpError(403, 'Hanya Admin atau Superadmin yang dapat menugaskan PIC prospek.');
  }
  const { id, brandId, existing } = await findScopedProspect(req);

  const targetUserId = req.body.userId ? Number(req.body.userId) : null;
  let targetUser = null;
  if (targetUserId) {
    targetUser = await findEligiblePic(targetUserId, brandId);
    if (!targetUser) throw new HttpError(400, 'User target bukan CS aktif yang memiliki akses ke brand ini.');
  }

  const linked = await linkedProspectIds(prisma, existing);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.prospect.updateMany({ where: { id: { in: linked }, brandId }, data: { userId: targetUserId } });
    const p = await tx.prospect.findUniqueOrThrow({ where: { id }, include });

    await tx.prospectLog.create({
      data: {
        prospectId: id,
        userId: req.user!.id,
        actionType: 'pic_assigned',
        title: targetUser
          ? `PIC dialihkan ke ${targetUser.name} oleh ${req.user!.name}`
          : `Penugasan PIC dilepas oleh ${req.user!.name}`,
        description: req.body.notes || (targetUser ? `Penugasan resmi dari ${req.user!.role}` : 'Lead kembali ke antrean publik tim CS'),
      },
    });
    return p;
  });

  emitToBrand(brandId, 'prospect:claimed', { prospectIds: linked, userId: targetUserId, userName: targetUser?.name ?? null });
  dispatch(() => notifyPicChange({
    prospect: { id, brandId, name: existing.name }, kind: 'assigned', fromUserId: existing.userId, toUserId: targetUserId,
    toName: targetUser?.name, actor: req.user!, reason: req.body.notes,
  }));
  emitToBrand(brandId, 'prospect:updated', updated);
  res.json({ success: true, data: updated });
}));

// Voluntary Handover by current CS or Manager (A08)
prospectsRouter.post('/:id/handover', asyncHandler(async (req, res) => {
  const { id, brandId, existing } = await findScopedProspect(req);

  const isCurrentPic = existing.userId === req.user!.id;
  const isManager = req.user!.role === 'admin' || req.user!.role === 'superadmin';
  if (!isCurrentPic && !isManager) {
    throw new HttpError(403, 'Hanya PIC saat ini atau Admin yang berhak melakukan handover prospek.');
  }

  const { targetUserId, reason } = z.object({
    targetUserId: z.number().int().positive().optional().nullable(),
    reason: z.string().trim().min(3, 'Alasan handover minimal 3 karakter').max(500),
  }).parse(req.body);

  if (targetUserId && targetUserId === existing.userId) throw new HttpError(422, 'Pilih CS lain sebagai PIC pengganti.');
  let targetUser = null;
  if (targetUserId) {
    targetUser = await findEligiblePic(targetUserId, brandId);
    if (!targetUser) throw new HttpError(400, 'User target bukan CS aktif yang memiliki akses ke brand ini.');
  }

  const linked = await linkedProspectIds(prisma, existing);
  const updated = await prisma.$transaction(async (tx) => {
    // Bersyarat pada PIC saat permintaan dibuat: handover tidak menimpa penugasan yang baru saja berubah.
    const moved = await tx.prospect.updateMany({ where: { id, brandId, userId: existing.userId }, data: { userId: targetUserId ?? null } });
    if (moved.count === 0) throw new HttpError(409, 'PIC prospek ini baru saja berubah. Muat ulang lalu coba lagi.');
    await tx.prospect.updateMany({ where: { id: { in: linked }, brandId }, data: { userId: targetUserId ?? null } });
    const p = await tx.prospect.findUniqueOrThrow({ where: { id }, include });

    await tx.prospectLog.create({
      data: {
        prospectId: id,
        userId: req.user!.id,
        actionType: 'pic_handover',
        title: targetUser
          ? `Handover ke ${targetUser.name}: ${reason}`
          : `Handover dilepas ke antrean publik: ${reason}`,
        description: `Oleh: ${req.user!.name} (${req.user!.role})`,
      },
    });
    return p;
  });

  emitToBrand(brandId, 'prospect:claimed', { prospectIds: linked, userId: targetUserId ?? null, userName: targetUser?.name ?? null });
  dispatch(() => notifyPicChange({
    prospect: { id, brandId, name: existing.name }, kind: 'handover', fromUserId: existing.userId, toUserId: targetUserId ?? null,
    toName: targetUser?.name, actor: req.user!, reason,
  }));
  emitToBrand(brandId, 'prospect:updated', updated);
  res.json({ success: true, data: updated });
}));

// Ambil alih: CS lain boleh mengambil prospek bila jamaah sudah menunggu balasan lebih dari 15 menit
// (dihitung dari pesan jamaah pertama yang belum dibalas). PIC lama tercatat di riwayat.
prospectsRouter.post('/:id/takeover', asyncHandler(async (req, res) => {
  if (req.user!.role !== 'cs') throw new HttpError(403, 'Hanya CS yang dapat mengambil alih prospek. Admin memakai Tugaskan PIC.');
  const { id, brandId, existing } = await findScopedProspect(req);
  if (!existing.userId) throw new HttpError(409, 'Prospek ini belum punya PIC. Gunakan Klaim.');
  if (existing.userId === req.user!.id) throw new HttpError(409, 'Anda sudah menjadi PIC prospek ini.');
  if (isClosedStatus(existing.status)) throw new HttpError(409, 'Prospek sudah Deal atau Batal; PIC hanya dapat diubah oleh Admin.');
  const me = await findEligiblePic(req.user!.id, brandId);
  if (!me) throw new HttpError(403, 'Akun Anda tidak aktif atau tidak memiliki akses ke brand ini.');

  const linked = await linkedProspectIds(prisma, existing);
  const chatFilter = { prospectId: { in: linked }, isDeleted: false, messageType: { notIn: ['protocolMessage', 'reactionMessage'] } };
  const recent = await prisma.chatMessage.findMany({
    where: chatFilter,
    select: { timestamp: true, isFromMe: true },
    orderBy: { timestamp: 'desc' },
    take: 200,
  });
  const since = firstUnansweredAt(recent);
  const opensAt = takeoverOpensAt(since);
  if (since === null || opensAt === null) {
    throw new HttpError(409, 'Jamaah tidak sedang menunggu balasan, jadi prospek tetap milik PIC saat ini.');
  }
  if (Date.now() < opensAt) {
    const waited = Math.max(0, Math.floor((Date.now() / 1000 - since) / 60));
    throw new HttpError(409, `Jamaah baru menunggu ${waited} menit. Prospek bisa diambil alih setelah ${PIC_TAKEOVER_AFTER_MINUTES} menit belum dibalas.`);
  }
  const previous = await prisma.user.findUnique({ where: { id: existing.userId }, select: { name: true } });
  const waitedMinutes = Math.floor((Date.now() / 1000 - since) / 60);

  const updated = await prisma.$transaction(async (tx) => {
    // PIC lama bisa saja membalas di antara pengecekan dan penyimpanan: batalkan bila sudah ada balasan.
    const replied = await tx.chatMessage.findFirst({ where: { ...chatFilter, isFromMe: true, timestamp: { gte: since } }, select: { id: true } });
    if (replied) throw new HttpError(409, 'PIC saat ini baru saja membalas jamaah. Prospek tetap miliknya.');
    const moved = await tx.prospect.updateMany({ where: { id, brandId, userId: existing.userId }, data: { userId: me.id } });
    if (moved.count === 0) throw new HttpError(409, 'PIC prospek ini baru saja berubah. Muat ulang lalu coba lagi.');
    await tx.prospect.updateMany({ where: { id: { in: linked }, brandId }, data: { userId: me.id } });
    await tx.prospectLog.create({
      data: {
        prospectId: id,
        userId: me.id,
        actionType: 'pic_taken_over',
        title: `PIC diambil alih oleh ${me.name} dari ${previous?.name ?? 'PIC sebelumnya'}`,
        description: `Jamaah belum dibalas ${waitedMinutes} menit (batas ${PIC_TAKEOVER_AFTER_MINUTES} menit)`,
      },
    });
    return tx.prospect.findUniqueOrThrow({ where: { id }, include });
  });

  emitToBrand(brandId, 'prospect:claimed', { prospectIds: linked, userId: me.id, userName: me.name, takenOverFrom: existing.userId });
  dispatch(() => notifyPicChange({
    prospect: { id, brandId, name: existing.name }, kind: 'taken_over', fromUserId: existing.userId, toUserId: me.id,
    actor: { id: me.id, name: me.name }, waitedMinutes,
  }));
  emitToBrand(brandId, 'prospect:updated', updated);
  res.json({ success: true, data: updated });
}));

prospectsRouter.patch('/:id/profile', asyncHandler(async (req, res) => {
  const { id, brandId, existing } = await findScopedProspect(req);
  await assertCanActOnProspect(req.user!, existing);

  // Settlement (nilai booking, kas, status bayar) tidak pernah diubah lewat profil.
  // Payload yang membawa nilai sama persis dengan data tersimpan dianggap tidak mengubah apa pun.
  const attempted = settlementFields.filter(
    (field) => req.body?.[field] !== undefined && !sameSettlementValue(field, req.body[field], existing[field]),
  );
  if (attempted.length > 0) {
    throw new HttpError(403, 'Nilai transaksi dan status pembayaran hanya dapat diubah melalui penawaran resmi dan verifikasi Finance.');
  }

  const input = prospectProfileSchema.parse(req.body);

  // Catatan bersifat tambah-saja (POST /:id/notes) agar isinya tidak bisa ditimpa tanpa jejak.
  if (input.notes !== undefined && (input.notes ?? '').trim() !== (existing.notes ?? '').trim()) {
    throw new HttpError(409, 'Catatan tidak dapat diubah. Tambahkan catatan baru agar riwayatnya tetap tercatat.');
  }

  // Paket dan pax booking yang sudah Deal terkunci: kuota seat sudah dipotong berdasarkan data ini.
  if (isWonStatus(existing.status)) {
    const changedBooking =
      (input.packageId !== undefined && (input.packageId ?? null) !== (existing.packageId ?? null)) ||
      (input.paxQuad !== undefined && input.paxQuad !== existing.paxQuad) ||
      (input.paxTriple !== undefined && input.paxTriple !== existing.paxTriple) ||
      (input.paxDouble !== undefined && input.paxDouble !== existing.paxDouble) ||
      (input.paxInfant !== undefined && input.paxInfant !== existing.paxInfant);
    if (changedBooking) {
      throw new HttpError(409, 'Paket dan jumlah pax booking Deal terkunci. Ajukan revisi booking ke Finance/Admin agar kuota seat ikut direkonsiliasi.');
    }
  }

  // Layanan custom: komposisi jamaah dan paket dasar adalah dasar hitungan Tim LA; diubah lewat form Layanan Custom.
  const custom = await activeCustomFor(id);
  if (custom) {
    const paxChanged = (['paxQuad', 'paxTriple', 'paxDouble', 'paxInfant'] as const).some((f) => input[f] !== undefined && input[f] !== existing[f]);
    const pkgChanged = input.packageId !== undefined && (input.packageId ?? null) !== (existing.packageId ?? null);
    if (paxChanged || pkgChanged) {
      throw new HttpError(409, 'Prospek memakai layanan custom: jumlah jamaah dan paket diubah lewat Layanan Custom (minta hitung ulang bila perlu).');
    }
  }

  const { nextFollowupDate, packageId, notes: _notes, ...rest } = input;
  const data: Prisma.ProspectUncheckedUpdateInput = { ...rest };
  if (nextFollowupDate !== undefined) {
    const key = dateOnlyKey(nextFollowupDate);
    data.nextFollowupDate = key ? new Date(`${key}T00:00:00.000Z`) : null;
  }
  if (packageId !== undefined) data.packageId = packageId;

  // Isian kualifikasi memakai pilihan baku. Nilai lama (teks bebas) yang dikirim ulang tanpa perubahan
  // tetap diterima agar profil lama masih bisa disimpan; nilai kosong disimpan sebagai null.
  const choice = (field: 'targetMonth' | 'budgetRange' | 'decisionMaker' | 'passportStatus', valid: (value: string) => boolean, message: string) => {
    const value = input[field];
    if (value === undefined) return;
    const text = value?.trim() ?? '';
    data[field] = text || null;
    if (text && text !== (existing[field] ?? '') && !valid(text)) throw new HttpError(422, message);
  };
  choice('targetMonth', (v) => {
    const parsed = parseTargetMonth(v);
    return parsed.key !== null && (!parsed.season || (TARGET_SEASONS as readonly string[]).includes(parsed.season));
  }, 'Bulan keberangkatan harus dipilih dari daftar bulan.');
  choice('budgetRange', (v) => BUDGET_OPTIONS.some((o) => o.value === v), 'Budget harus dipilih dari daftar.');
  choice('decisionMaker', (v) => DECISION_MAKER_OPTIONS.some((o) => o.value === v), 'Pengambil keputusan harus dipilih dari daftar.');
  choice('passportStatus', (v) => PASSPORT_OPTIONS.some((o) => o.value === v), 'Status paspor harus dipilih dari daftar.');

  const merged = {
    targetMonth: input.targetMonth !== undefined ? input.targetMonth : existing.targetMonth,
    paxQuad: input.paxQuad ?? existing.paxQuad,
    paxTriple: input.paxTriple ?? existing.paxTriple,
    paxDouble: input.paxDouble ?? existing.paxDouble,
    paxInfant: input.paxInfant ?? existing.paxInfant,
    budgetRange: input.budgetRange !== undefined ? input.budgetRange : existing.budgetRange,
    passportStatus: input.passportStatus !== undefined ? input.passportStatus : existing.passportStatus,
  };
  // Kamar utama tidak diisi terpisah: diturunkan dari jamaah dewasa per tipe kamar.
  data.roomPreference = primaryRoomOf(merged) ?? (input.roomPreference !== undefined ? input.roomPreference : existing.roomPreference);

  // Syarat kualifikasi tidak boleh dihapus setelah prospek Terkualifikasi (sampai Deal). Profil lama yang
  // memang belum lengkap tetap bisa disimpan (mis. menambah catatan).
  if ((QUALIFIED_ONWARD as readonly string[]).includes(existing.status) && isQualificationComplete(existing) && !isQualificationComplete(merged)) {
    throw new HttpError(422, `Prospek sudah Terkualifikasi: ${qualificationMissing(merged).join(' dan ')} tidak boleh dikosongkan.`);
  }

  // Isian boleh bertahap; naik otomatis ke Terkualifikasi hanya bila semua syarat terisi.
  const promotedToQualified = isQualificationComplete(merged) && ['new', 'contact', 'identifying'].includes(existing.status);
  if (promotedToQualified) data.status = 'qualified';

  // Penawaran yang sudah terkirim memakai jamaah/paket lama: catat agar CS mengirim ulang sebelum invoice.
  const bookingChanged = (['paxQuad', 'paxTriple', 'paxDouble', 'paxInfant'] as const).some((f) => input[f] !== undefined && input[f] !== existing[f])
    || (packageId !== undefined && (packageId ?? null) !== (existing.packageId ?? null));
  const offerOutdated = Boolean(existing.offerSentAt) && bookingChanged && !isWonStatus(existing.status) && !isLostStatus(existing.status);
  const adults = (merged.paxQuad ?? 0) + (merged.paxTriple ?? 0) + (merged.paxDouble ?? 0);

  const packageChanged = packageId !== undefined && (packageId ?? null) !== (existing.packageId ?? null);
  const packageNames = packageChanged
    ? await prisma.package.findMany({ where: { id: { in: [existing.packageId, packageId].filter((v): v is number => Boolean(v)) } }, select: { id: true, name: true } })
    : [];
  const changes = describeProfileChanges(existing as unknown as Record<string, unknown>, { ...rest, ...(nextFollowupDate !== undefined ? { nextFollowupDate: data.nextFollowupDate } : {}) }, packageChanged
    ? { before: packageNames.find((pkg) => pkg.id === existing.packageId)?.name ?? null, after: packageNames.find((pkg) => pkg.id === packageId)?.name ?? null }
    : undefined);

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.prospect.update({ where: { id }, data, include });
    // Hanya perubahan nyata yang dicatat, lengkap dengan nilai lama → baru.
    if (changes.length) {
      await tx.prospectLog.create({
        data: {
          prospectId: id,
          userId: req.user!.id,
          actionType: 'profile_updated',
          title: changes.length === 1 ? `${changes[0]!.split(':')[0]} diubah` : 'Data prospek diubah',
          description: changes.join('\n'),
        },
      });
    }
    if (promotedToQualified) {
      await tx.prospectLog.create({
        data: {
          prospectId: id,
          userId: req.user!.id,
          actionType: 'status_changed',
          title: 'Status otomatis menjadi Terkualifikasi',
          description: `Kualifikasi lengkap: ${targetMonthLabel(merged.targetMonth) ?? merged.targetMonth}, ${adults} dewasa${merged.paxInfant ? ` + ${merged.paxInfant} bayi` : ''}`,
        },
      });
    }
    if (offerOutdated) {
      await tx.prospectLog.create({
        data: {
          prospectId: id,
          userId: req.user!.id,
          actionType: 'offer_outdated',
          title: 'Penawaran perlu dikirim ulang',
          description: 'Jumlah jamaah atau paket berubah setelah penawaran terkirim; nilai penawaran lama tidak lagi sesuai.',
        },
      });
    }
    return p;
  });

  emitToBrand(brandId, 'prospect:updated', updated);
  res.json({ success: true, data: updated });
}));

/** Riwayat prospek: semua aktivitas tercatat, terbaru di atas. `legacyNote` = catatan lama sebelum catatan tambah-saja. */
prospectsRouter.get('/:id/logs', asyncHandler(async (req, res) => {
  const { id, existing } = await findScopedProspect(req);
  const logs = await prisma.prospectLog.findMany({
    where: { prospectId: id },
    include: { user: { select: { name: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 300,
  });
  res.json({ success: true, data: { logs, legacyNote: existing.notes?.trim() || null, legacyNoteAt: existing.createdAt } });
}));

/** Catatan CS bersifat tambah-saja: tidak bisa diedit atau dihapus, koreksi ditulis sebagai catatan baru. */
prospectsRouter.post('/:id/notes', asyncHandler(async (req, res) => {
  const { note } = z.object({ note: z.string().trim().min(1, 'Catatan kosong.').max(2000) }).parse(req.body);
  const { brandId, existing } = await findScopedProspect(req);
  await assertCanActOnProspect(req.user!, existing);
  if (isWonStatus(existing.status)) throw new HttpError(409, 'Penanganan CS selesai pada Deal; catatan berikutnya di luar CRM.');
  const log = await prisma.prospectLog.create({
    data: { prospectId: existing.id, userId: req.user!.id, actionType: 'note_added', title: 'Catatan', description: note },
    include: { user: { select: { name: true } } },
  });
  emitToBrand(brandId, 'prospect:updated', { id: existing.id });
  res.status(201).json({ success: true, data: log });
}));

// Trigger 3: Send Official Offer -> offer
prospectsRouter.post('/:id/offer', asyncHandler(async (req, res) => {
  const { id, brandId, existing } = await findScopedProspect(req);
  await assertCanActOnProspect(req.user!, existing);
  const input = offerInputSchema.parse(req.body);

  if (isWonStatus(existing.status)) {
    throw new HttpError(409, 'Booking sudah Deal; nilai dan paket terkunci. Revisi booking melalui Finance/Admin.');
  }

  // Layanan custom: nilai penawaran = nilai deal akhir yang disepakati CS (≥ harga terendah Tim LA).
  const custom = await activeCustomFor(id);
  const agreed = custom ? assertAgreedCustom(custom, existing) : null;
  if (!custom && !input.packageId) throw new HttpError(422, 'Pilih paket untuk penawaran.');
  const pkgId = custom ? agreed!.basePackageId : input.packageId!;
  const pkg = pkgId ? await prisma.package.findFirst({ where: { id: pkgId, brandId } }) : null;
  if (pkgId && !pkg) throw new HttpError(404, 'Paket umroh tidak ditemukan.');
  const offerName = custom ? `Layanan custom${pkg ? ` (dasar ${pkg.name})` : ''}` : pkg!.name;

  // Nilai penawaran = harga katalog × pax. Override (diskon) hanya oleh admin/finance dan tercatat di log.
  const catalogValue = custom ? agreed!.agreedPrice : packageBookingValue(pkg!, existing);
  const canOverride = !custom && FINANCE_ROLES.includes(req.user!.role);
  const isOverride = canOverride && input.dealValue !== undefined && input.dealValue !== catalogValue;
  const dealValue = isOverride ? input.dealValue! : catalogValue;

  // Kirim dulu; status "terkirim" hanya dicatat bila gateway mengembalikan messageId.
  let sentMessageId: string | null = null;
  if (input.sendViaWhatsApp) {
    if (!input.messageText) throw new HttpError(422, 'Naskah penawaran wajib disertakan untuk dikirim.');
    const message = await sendTextToProspect({
      user: req.user!,
      brandId,
      prospectId: id,
      text: input.messageText,
      allowFinance: false,
      logTitle: `Naskah penawaran ${offerName} dikirim oleh ${req.user!.name}`,
    });
    sentMessageId = message.messageId;
  }
  const sent = sentMessageId !== null;
  // Jangan menurunkan prospek yang sudah di tahap invoice (closing) kembali ke offer.
  const promote = sent && existing.status !== 'closing';

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.prospect.update({
      where: { id },
      data: {
        packageId: pkg?.id ?? null,
        dealValue,
        ...(sent ? { offerSentAt: new Date(), offerMessageId: sentMessageId } : {}),
        ...(promote ? { status: 'offer' } : {}),
      },
      include,
    });

    await tx.prospectLog.create({
      data: {
        prospectId: id,
        userId: req.user!.id,
        actionType: sent ? 'offer_sent' : 'offer_drafted',
        title: sent ? `Penawaran resmi terkirim: ${offerName}` : `Draft penawaran disiapkan: ${offerName}`,
        description: [
          `Nilai booking: Rp ${dealValue.toLocaleString('id-ID')}${isOverride ? ` (override ${req.user!.role}; katalog Rp ${catalogValue.toLocaleString('id-ID')})` : ''}`,
          input.paxSummary || null,
          input.customNotes ? `Catatan: ${input.customNotes}` : null,
          sentMessageId ? `WA messageId: ${sentMessageId}` : null,
        ].filter(Boolean).join(' · '),
      },
    });
    return p;
  });

  emitToBrand(brandId, 'prospect:updated', updated);
  if (promote) queueCapiForStatus(id, 'offer');
  res.json({ success: true, data: { ...updated, delivery: { sent, messageId: sentMessageId } } });
}));

// Trigger 4: Record Objection -> objection
prospectsRouter.post('/:id/objection', asyncHandler(async (req, res) => {
  const { id, brandId, existing } = await findScopedProspect(req);
  await assertCanActOnProspect(req.user!, existing);
  if (isWonStatus(existing.status)) {
    throw new HttpError(409, 'Booking sudah Deal; keberatan tidak dapat menurunkan tahap. Catat sebagai catatan/aktivitas.');
  }

  const { category, notes } = objectionInputSchema.parse(req.body);
  const categoryLabels: Record<string, string> = {
    price: 'Harga terlalu mahal / di luar budget',
    competitor: 'Bandingkan dengan travel lain',
    schedule_leave: 'Kendala jadwal kerja / cuti',
    passport: 'Paspor belum siap / bermasalah',
    family_decision: 'Keluarga belum sepakat',
    facility_distance: 'Ragu fasilitas / jarak hotel',
    other: 'Keberatan lainnya',
  };

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.prospect.update({
      where: { id },
      data: {
        status: 'objection',
        objectionCategory: category,
        objectionNotes: notes,
      },
      include,
    });

    await tx.prospectLog.create({
      data: {
        prospectId: id,
        userId: req.user!.id,
        actionType: 'objection_logged',
        title: `Keberatan dicatat: ${categoryLabels[category] ?? category}`,
        description: notes,
      },
    });
    return p;
  });

  emitToBrand(brandId, 'prospect:updated', updated);
  res.json({ success: true, data: updated });
}));

// Trigger 5: Schedule Follow-up -> followup
prospectsRouter.post('/:id/activities', asyncHandler(async (req, res) => {
  const activitySchema = z.object({
    type: z.enum(['call', 'whatsapp', 'meeting', 'email', 'note']).default('whatsapp'),
    note: z.string().trim().min(1).max(5000),
    nextFollowupDate: z.string().date().optional().nullable(),
  });
  const { type, note, nextFollowupDate } = activitySchema.parse(req.body);
  const { brandId, existing: prospect } = await findScopedProspect(req);
  await assertCanActOnProspect(req.user!, prospect);
  if (isWonStatus(prospect.status)) throw new HttpError(409, 'Penanganan CS selesai pada Deal; tindak lanjut berikutnya di luar CRM.');
  const typeLabel: Record<string, string> = { call: 'Telepon', whatsapp: 'WhatsApp', meeting: 'Pertemuan', email: 'Email', note: 'Catatan' };
  // Catatan pada prospek batal tidak mengubah tahapnya.
  const keepStage = isWonStatus(prospect.status) || isLostStatus(prospect.status);

  await prisma.$transaction(async (tx) => {
    await tx.prospectLog.create({
      data: {
        prospectId: prospect.id,
        userId: req.user!.id,
        actionType: 'followup_logged',
        title: `Follow-up via ${typeLabel[type] ?? type}`,
        description: note,
      },
    });
    await tx.prospect.update({
      where: { id: prospect.id },
      data: {
        lastFollowupAt: new Date(),
        ...(nextFollowupDate ? { nextFollowupDate: new Date(`${nextFollowupDate}T00:00:00.000Z`) } : {}),
        ...(nextFollowupDate && !keepStage ? { status: 'followup' } : {}),
      },
    });
  });

  const updated = await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id }, include });
  emitToBrand(brandId, 'prospect:updated', updated);
  res.status(201).json({ success: true, data: updated });
}));

// Trigger 6: Send DP Invoice -> closing
prospectsRouter.post('/:id/invoice', asyncHandler(async (req, res) => {
  const { id, brandId, existing } = await findScopedProspect(req);
  if (isWonStatus(existing.status)) throw new HttpError(409, 'Prospek sudah Deal; pembayaran berikutnya dicatat di luar CRM.');
  await assertCanActOnProspect(req.user!, existing);
  // Klien lama mengirim nominal tagihan sebagai `dpAmount`; diterima sebagai alias tagihan, bukan kas.
  const input = invoiceInputSchema.parse({ invoiceAmount: req.body?.dpAmount, ...req.body });
  const isWon = isWonStatus(existing.status);

  if (isWon && input.packageId && input.packageId !== existing.packageId) {
    throw new HttpError(409, 'Paket booking Deal terkunci. Revisi booking melalui Finance/Admin.');
  }
  // Layanan custom: tagihan pembayaran awal antara DP minimal (per jamaah dari Tim LA) dan nilai deal akhir.
  const custom = await activeCustomFor(id);
  if (custom) {
    const agreed = assertAgreedCustom(custom, existing);
    if (input.invoiceAmount < agreed.minDpTotal) {
      throw new HttpError(422, `Tagihan di bawah DP minimal layanan custom (Rp ${agreed.minDpTotal.toLocaleString('id-ID')}).`);
    }
    if (input.invoiceAmount > agreed.agreedPrice) {
      throw new HttpError(422, `Tagihan melebihi nilai deal (Rp ${agreed.agreedPrice.toLocaleString('id-ID')}).`);
    }
    input.packageId = agreed.basePackageId;
  }
  if (!isWon && input.packageId) {
    const pkg = await prisma.package.findFirst({ where: { id: input.packageId, brandId }, select: { id: true } });
    if (!pkg) throw new HttpError(404, 'Paket umroh tidak ditemukan.');
  }

  const now = new Date();
  const invoiceNum = existing.invoiceNumber
    ?? `INV/${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}/${String(existing.id).padStart(4, '0')}`;
  const dueAt = input.dueDate ? new Date(input.dueDate) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (Number.isNaN(dueAt.getTime())) throw new HttpError(422, 'Tanggal jatuh tempo tidak valid.');

  let sentMessageId: string | null = null;
  if (input.sendViaWhatsApp) {
    if (!input.messageText) throw new HttpError(422, 'Naskah invoice wajib disertakan untuk dikirim.');
    const message = await sendTextToProspect({
      user: req.user!,
      brandId,
      prospectId: id,
      text: input.messageText,
      allowFinance: false,
      logTitle: `Naskah invoice ${invoiceNum} dikirim oleh ${req.user!.name}`,
    });
    sentMessageId = message.messageId;
  }
  const sent = sentMessageId !== null;
  const promote = sent && !isWon;

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.prospect.update({
      where: { id },
      data: {
        // Hanya nominal TAGIHAN. Kas (dpAmount) hanya ditulis oleh verifikasi Finance.
        invoiceNumber: invoiceNum,
        invoiceDueAt: dueAt,
        invoiceAmount: input.invoiceAmount,
        ...(!isWon && input.packageId ? { packageId: input.packageId } : {}),
        ...(sent ? { invoiceSentAt: now, invoiceMessageId: sentMessageId } : {}),
        ...(promote ? { status: 'closing' } : {}),
      },
      include,
    });

    await tx.prospectLog.create({
      data: {
        prospectId: id,
        userId: req.user!.id,
        actionType: sent ? 'invoice_sent' : 'invoice_drafted',
        title: sent ? `Invoice resmi terkirim: ${invoiceNum}` : `Draft invoice disiapkan: ${invoiceNum}`,
        description: [
          `Nominal tagihan: Rp ${Number(input.invoiceAmount).toLocaleString('id-ID')}`,
          `Jatuh tempo: ${dueAt.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`,
          sentMessageId ? `WA messageId: ${sentMessageId}` : null,
        ].filter(Boolean).join(' · '),
      },
    });
    return p;
  });

  emitToBrand(brandId, 'prospect:updated', updated);
  if (promote) queueCapiForStatus(id, 'closing');
  res.json({ success: true, data: { ...updated, delivery: { sent, messageId: sentMessageId } } });
}));

const MAX_CHAT_PROOF_BYTES = 15 * 1024 * 1024;

/** Simpan berkas bukti ke storage privat; jenis ditentukan dari isi berkas (magic bytes). */
async function storeProofFile(prospectId: number, buffer: Buffer) {
  const extension = detectProofType(buffer);
  if (!extension) {
    throw new HttpError(400, 'Format berkas tidak valid. Harap gunakan gambar JPG, PNG, WEBP, atau file PDF.');
  }
  const proofsDir = PROOFS_DIR();
  await fs.promises.mkdir(proofsDir, { recursive: true });
  const safeFilename = `proof-${prospectId}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extension}`;
  await fs.promises.writeFile(path.join(proofsDir, safeFilename), buffer);
  return `${PAYMENT_PROOF_PATH_PREFIX}${safeFilename}`;
}

async function recordPaymentProof(
  req: Request,
  id: number,
  brandId: number,
  name: string,
  fileUrl: string,
  notes?: string,
  source?: { messageId: string },
) {
  const updated = await prisma.$transaction(async (tx) => {
    const assigned = await tx.prospect.updateMany({
      where: { id, brandId, status: { notIn: WON_STATUSES } },
      data: {
        paymentProofUrl: fileUrl,
        paymentProofMessageId: source?.messageId ?? null,
        paymentProofSubmittedAt: new Date(),
      },
    });

    if (assigned.count !== 1) throw new HttpError(409, 'Prospek sudah Deal; pembayaran berikutnya dicatat di luar CRM.');
    const p = await tx.prospect.findUniqueOrThrow({ where: { id }, include });

    await tx.prospectLog.create({
      data: {
        prospectId: id,
        userId: req.user!.id,
        actionType: 'payment_proof_submitted',
        title: source ? 'Bukti transfer diambil dari chat WhatsApp untuk verifikasi Finance' : 'Bukti transfer diunggah untuk verifikasi Finance',
        description: notes || 'Menunggu verifikasi mutasi rekening oleh tim Finance',
      },
    });
    return p;
  });

  emitToBrand(brandId, 'prospect:updated', updated);
  emitToBrand(brandId, 'finance:payment_proof_new', { prospectId: id, name });
  dispatch(() => notifyProofSubmitted({ id, brandId, name }, req.user!, Boolean(source)));
  return updated;
}

// Legacy: tautkan ulang berkas privat yang sudah diunggah. Data URL / URL bebas ditolak (A06).
prospectsRouter.post('/:id/payment-proof', asyncHandler(async (req, res) => {
  const { id, brandId, existing } = await findScopedProspect(req);
  if (isWonStatus(existing.status)) throw new HttpError(409, 'Prospek sudah Deal; pembayaran berikutnya dicatat di luar CRM.');
  await assertCanActOnProspect(req.user!, existing, { finance: true });
  const { paymentProofUrl, notes } = paymentProofSchema.parse(req.body);
  const filename = paymentProofUrl.slice(PAYMENT_PROOF_PATH_PREFIX.length);
  if (!filename.startsWith(`proof-${id}-`) || !fs.existsSync(path.join(PROOFS_DIR(), filename))) {
    throw new HttpError(422, 'Berkas bukti transfer tidak ditemukan untuk prospek ini. Unggah ulang bukti transfer.');
  }
  const updated = await recordPaymentProof(req, id, brandId, existing.name, paymentProofUrl, notes);
  res.json({ success: true, data: updated });
}));

// Upload payment proof binary safely without bloating MySQL TEXT column (A06 & A20)
prospectsRouter.post('/:id/payment-proof-upload', asyncHandler(async (req, res) => {
  const { id, brandId, existing } = await findScopedProspect(req);
  if (isWonStatus(existing.status)) throw new HttpError(409, 'Prospek sudah Deal; pembayaran berikutnya dicatat di luar CRM.');
  await assertCanActOnProspect(req.user!, existing, { finance: true });

  const uploadSchema = z.object({
    image: z.string().min(1, 'Data berkas bukti transfer wajib disertakan.').max(8_000_000, 'Ukuran berkas bukti transfer melebihi batas 5MB.'),
    notes: z.string().max(1000).optional(),
    brandId: z.coerce.number().int().positive().optional(),
  });
  const { image, notes } = uploadSchema.parse(req.body);

  const commaIdx = image.startsWith('data:') ? image.indexOf(',') : -1;
  const base64Data = commaIdx !== -1 ? image.slice(commaIdx + 1) : image;

  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > 5 * 1024 * 1024) {
    throw new HttpError(400, 'Ukuran berkas bukti transfer melebihi batas 5MB.');
  }

  const fileUrl = await storeProofFile(id, buffer);
  const updated = await recordPaymentProof(req, id, brandId, existing.name, fileUrl, notes);
  res.json({ success: true, data: updated });
}));

// Bukti transfer langsung dari pesan WhatsApp jamaah: berkas disalin di server ke penyimpanan
// privat, tanpa CS mengunduh lalu mengunggah ulang.
prospectsRouter.post('/:id/payment-proof-from-message', asyncHandler(async (req, res) => {
  const { id, brandId, existing } = await findScopedProspect(req);
  if (isWonStatus(existing.status)) throw new HttpError(409, 'Prospek sudah Deal; pembayaran berikutnya dicatat di luar CRM.');
  await assertCanActOnProspect(req.user!, existing, { finance: true });
  const { messageId, notes } = z.object({
    messageId: z.coerce.number().int().positive(),
    notes: z.string().max(1000).optional(),
  }).parse(req.body);

  const message = await prisma.chatMessage.findFirst({ where: { id: messageId, brandId, isDeleted: false } });
  if (!message) throw new HttpError(404, 'Pesan tidak ditemukan.');

  // Pesan harus berasal dari percakapan jamaah yang sama (prospek duplikat dari LID/nomor ikut diterima).
  const phone = normalizePhoneIdentifier(existing.phone);
  const samePerson = message.prospectId === id
    || Boolean(existing.remoteJid && message.remoteJid === existing.remoteJid)
    || Boolean(phone && normalizePhoneIdentifier(message.phone) === phone);
  if (!samePerson) throw new HttpError(422, 'Pesan ini bukan dari percakapan prospek tersebut.');
  if (!['imageMessage', 'documentMessage'].includes(message.messageType) || !message.mediaUrl) {
    throw new HttpError(422, 'Hanya pesan gambar atau dokumen PDF yang dapat dijadikan bukti transfer.');
  }

  // Pengajuan ulang pesan yang sama tidak membuat berkas/log ganda.
  if (existing.paymentProofMessageId === message.messageId && existing.paymentProofUrl) {
    const current = await prisma.prospect.findUniqueOrThrow({ where: { id }, include });
    return res.json({ success: true, data: current });
  }

  const sourcePath = await resolveChatMediaFile(message.mediaUrl);
  if (!sourcePath) throw new HttpError(404, 'Berkas media pesan tidak ditemukan di server. Minta jamaah mengirim ulang.');
  const buffer = await fs.promises.readFile(sourcePath);
  if (buffer.length > MAX_CHAT_PROOF_BYTES) throw new HttpError(400, 'Ukuran berkas melebihi 15MB.');

  const fileUrl = await storeProofFile(id, buffer);
  const updated = await recordPaymentProof(req, id, brandId, existing.name, fileUrl, notes, { messageId: message.messageId });
  res.json({ success: true, data: updated });
}));

// Authenticated private download route for payment proofs (A20).
// Akses hanya bila berkas terkait prospek (nama berkas memuat id prospek dan tercatat sebagai
// bukti bayar / lampiran ledger prospek tsb) dan user berhak atas brand prospek itu.
prospectsRouter.get('/payment-proof-file/:filename', asyncHandler(async (req, res) => {
  const filename = String(req.params.filename ?? '');
  if (!/^proof-\d+-[A-Za-z0-9._-]+$/.test(filename) || path.basename(filename) !== filename) {
    throw new HttpError(400, 'Nama berkas tidak valid.');
  }
  const prospectId = Number(filename.split('-')[1]);
  const fileUrl = `${PAYMENT_PROOF_PATH_PREFIX}${filename}`;
  const owner = await prisma.prospect.findFirst({
    where: { id: prospectId },
    select: {
      brandId: true,
      paymentProofUrl: true,
      payments: { where: { proofUrl: fileUrl }, select: { id: true }, take: 1 },
      // Bukti yang ditolak tetap bisa ditinjau di Riwayat Verifikasi.
      proofRejections: { where: { proofUrl: fileUrl }, select: { id: true }, take: 1 },
    },
  });
  if (!owner || (owner.paymentProofUrl !== fileUrl && owner.payments.length === 0 && owner.proofRejections.length === 0)) {
    throw new HttpError(404, 'Berkas bukti transfer tidak ditemukan.');
  }
  scopedBrandId(req, owner.brandId);

  const filePath = path.join(PROOFS_DIR(), filename);
  if (!fs.existsSync(filePath)) {
    throw new HttpError(404, 'Berkas bukti transfer tidak ditemukan.');
  }

  const ext = path.extname(filename).toLowerCase();
  let contentType = 'application/octet-stream';
  if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
  else if (ext === '.png') contentType = 'image/png';
  else if (ext === '.webp') contentType = 'image/webp';
  else if (ext === '.pdf') contentType = 'application/pdf';

  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  fs.createReadStream(filePath).pipe(res);
}));

// Trigger 7: Finance verifies payment -> deal
// Verifikasi awal = satu bukti audit pembayaran dan satu transisi Deal.
// Kemenangan (Deal) & pemotongan seat hanya dilakukan oleh request yang benar-benar
// mengubah status menjadi deal (conditional update), sehingga approval paralel aman.
// Finance menolak bukti yang tidak valid (nominal/rekening tidak cocok, bukan bukti transfer, dsb.).
// Bukti dilepas dari antrean agar CS meminta bukti yang benar; berkasnya tetap tersimpan untuk audit.
prospectsRouter.post('/:id/reject-proof', asyncHandler(async (req, res) => {
  if (!FINANCE_ROLES.includes(req.user!.role)) {
    throw new HttpError(403, 'Hanya tim Finance atau Admin yang dapat menolak bukti transfer.');
  }
  const { id, brandId, existing } = await findScopedProspect(req);
  if (isWonStatus(existing.status)) throw new HttpError(409, 'Prospek sudah Deal; pembayaran berikutnya dicatat di luar CRM.');
  const { reason } = z.object({
    reason: z.string().trim().min(3, 'Alasan penolakan minimal 3 karakter').max(500),
  }).parse(req.body);
  if (!existing.paymentProofUrl) throw new HttpError(409, 'Tidak ada bukti transfer yang menunggu verifikasi.');
  const used = await prisma.payment.findFirst({ where: { prospectId: id, proofUrl: existing.paymentProofUrl }, select: { id: true } });
  if (used) throw new HttpError(409, 'Bukti ini sudah dipakai untuk pembayaran terverifikasi dan tidak dapat ditolak.');

  const updated = await prisma.$transaction(async (tx) => {
    // Bersyarat pada bukti yang dilihat Finance: bukti baru yang masuk bersamaan tidak ikut terhapus.
    const cleared = await tx.prospect.updateMany({
      where: { id, brandId, paymentProofUrl: existing.paymentProofUrl },
      data: { paymentProofUrl: null, paymentProofMessageId: null, paymentProofSubmittedAt: null },
    });
    if (cleared.count === 0) throw new HttpError(409, 'Bukti transfer baru saja berubah. Muat ulang antrean lalu coba lagi.');
    await tx.prospectLog.create({
      data: {
        prospectId: id,
        userId: req.user!.id,
        actionType: 'payment_proof_rejected',
        title: 'Bukti transfer ditolak Finance',
        description: `Alasan: ${reason} · Berkas: ${existing.paymentProofUrl} · Oleh: ${req.user!.name}`,
      },
    });
    await tx.paymentProofRejection.create({
      data: {
        brandId, prospectId: id, kind: 'rejected', reason, rejectedById: req.user!.id,
        proofUrl: existing.paymentProofUrl, proofMessageId: existing.paymentProofMessageId,
      },
    });
    return tx.prospect.findUniqueOrThrow({ where: { id }, include });
  });

  emitToBrand(brandId, 'prospect:updated', updated);
  dispatch(() => notifyProofRejected({ prospect: { id, brandId, name: existing.name, userId: existing.userId }, actor: req.user!, reason }));
  res.json({ success: true, data: updated });
}));

prospectsRouter.post('/:id/verify-payment', asyncHandler(async (req, res) => {
  if (!FINANCE_ROLES.includes(req.user!.role)) {
    throw new HttpError(403, 'Hanya tim Finance atau Admin yang dapat memvalidasi pembayaran.');
  }
  const { id, brandId, existing } = await findScopedProspect(req);
  const input = paymentVerifySchema.parse(req.body);
  const amount = Number(input.approvedAmount);
  const referenceNo = input.referenceNo?.trim() || null;
  const mutationDate = input.mutationDate || null;
  if (mutationDate && mutationDate > businessDateKey()) throw new HttpError(422, 'Tanggal mutasi tidak boleh di masa depan.');

  if (isLostStatus(existing.status)) {
    throw new HttpError(409, 'Prospek berstatus batal (lose). Aktifkan kembali prospek sebelum mencatat pembayaran.');
  }

  // Tanpa key dari client, sidik jari mutasi dipakai: request identik tidak tercatat dua kali.
  const fingerprint = input.idempotencyKey
    ?? `auto:${amount}:${input.bankName}:${mutationDate ?? businessDateKey()}:${referenceNo ?? ''}`;
  const idempotencyKey = `${brandId}:${id}:${fingerprint}`.slice(0, 120);

  const replay = async () => {
    const prospect = await prisma.prospect.findUniqueOrThrow({ where: { id }, include });
    return res.json({ success: true, data: { ...prospect, duplicate: true } });
  };
  if (await prisma.payment.findUnique({ where: { idempotencyKey } })) return replay();

  if (isWonStatus(existing.status)) throw new HttpError(409, 'Prospek sudah Deal; pembayaran berikutnya dicatat di luar CRM.');

  // Layanan custom: pembayaran awal minimal DP yang ditetapkan Tim LA. Kuota hanya dipotong bila ada paket dasar.
  const custom = await activeCustomFor(id);
  if (custom) {
    const agreed = assertAgreedCustom(custom, existing);
    if (amount < agreed.minDpTotal) {
      throw new HttpError(422, `Pembayaran di bawah DP minimal layanan custom (Rp ${agreed.minDpTotal.toLocaleString('id-ID')}). Tolak bukti bila transfer kurang.`);
    }
  }

  const seatCount = seatCountFor(existing);

  let outcome: { prospect: Awaited<ReturnType<typeof prisma.prospect.update>>; isNewWin: boolean; seatsTaken: number; isPaidFull: boolean; total: number };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      // Atomic claim of the win: only one concurrent request can flip a non-deal row to deal.
      const win = await tx.prospect.updateMany({
        where: { id, brandId, status: { notIn: [...WON_STATUSES, 'lose', 'closed_lost'] } },
        data: { status: 'deal', closedWonCount: { increment: 1 } },
      });
      if (win.count !== 1) throw new HttpError(409, 'Prospek sudah Deal; pembayaran berikutnya dicatat di luar CRM.');
      const isNewWin = true;

      let seatsTaken = 0;
      if (isNewWin && existing.packageId) {
        const pkg = await tx.package.findUnique({ where: { id: existing.packageId } });
        if (pkg && pkg.quotaRemaining !== null) {
          // Conditional decrement: never oversell even when two families race for the last seats.
          const taken = await tx.package.updateMany({
            where: { id: pkg.id, quotaRemaining: { gte: seatCount } },
            data: { quotaRemaining: { decrement: seatCount } },
          });
          if (taken.count !== 1) {
            throw new HttpError(409, `Kuota paket "${pkg.name}" tidak mencukupi (tersisa ${pkg.quotaRemaining}, dibutuhkan ${seatCount} seat).`);
          }
          seatsTaken = seatCount;
        }
      }

      await tx.payment.create({
        data: {
          brandId,
          prospectId: id,
          amount,
          bankName: input.bankName,
          referenceNo,
          mutationDate: mutationDate ? new Date(`${mutationDate}T00:00:00.000Z`) : null,
          idempotencyKey,
          notes: input.notes || null,
          proofUrl: existing.paymentProofUrl,
          proofMessageId: existing.paymentProofMessageId,
          verifiedByUserId: req.user!.id,
        },
      });

      // Snapshot nilai booking dari katalog bila belum pernah ditetapkan lewat penawaran resmi.
      let bookingValue = Number(existing.dealValue) || 0;
      if (bookingValue <= 0 && existing.packageId) {
        const pkg = await tx.package.findUnique({ where: { id: existing.packageId } });
        if (pkg) bookingValue = packageBookingValue(pkg, existing);
      }

      const afterCash = await tx.prospect.update({
        where: { id },
        data: {
          dpAmount: amount,
          verifiedByUserId: req.user!.id,
          ...(bookingValue !== Number(existing.dealValue) ? { dealValue: bookingValue } : {}),
          ...(isNewWin ? { dpPaidAt: mutationDate ? new Date(`${mutationDate}T00:00:00.000Z`) : new Date(), seatsReserved: seatsTaken } : {}),
        },
        select: { dpAmount: true, dealValue: true },
      });
      const total = Number(afterCash.dpAmount);
      const isPaidFull = input.paymentType === 'full';
      const paymentStatus: PaymentStatus = isPaidFull ? 'paid_full' : 'partial_dp';

      const p = await tx.prospect.update({ where: { id }, data: { paymentStatus }, include });

      await tx.prospectLog.create({
        data: {
          prospectId: id,
          userId: req.user!.id,
          actionType: 'payment_verified',
          title: `Pembayaran awal ${isPaidFull ? 'Lunas' : 'DP'} diverifikasi Finance: Rp ${amount.toLocaleString('id-ID')}`,
          description: [
            `Bank: ${input.bankName}`,
            referenceNo ? `Ref: ${referenceNo}` : null,
            mutationDate ? `Mutasi: ${mutationDate}` : null,
            isNewWin ? `Kuota terpakai: ${seatsTaken || seatCount} seat` : null,
            input.notes ? `Catatan: ${input.notes}` : null,
            `Oleh: ${req.user!.name}`,
          ].filter(Boolean).join(' · '),
        },
      });

      return { prospect: p, isNewWin, seatsTaken, isPaidFull, total };
    });
  } catch (error) {
    // A concurrent retry may lose the Deal claim after the original request commits.
    if (await prisma.payment.findUnique({ where: { idempotencyKey } })) return replay();
    // Unique idempotency key / reference hit by a concurrent twin request: treat as replay.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = String((error.meta as { target?: unknown } | undefined)?.target ?? '');
      if (target.includes('reference_no') || target.includes('referenceNo')) {
        const dup = referenceNo ? await prisma.payment.findFirst({ where: { brandId, referenceNo } }) : null;
        if (dup && dup.prospectId !== id) {
          throw new HttpError(409, `Nomor referensi mutasi ${referenceNo} sudah dipakai untuk prospek lain.`);
        }
      }
      return replay();
    }
    throw error;
  }

  emitToBrand(brandId, 'prospect:updated', outcome.prospect);
  if (outcome.seatsTaken > 0 && existing.packageId) {
    emitToBrand(brandId, 'package:quota_updated', { packageId: existing.packageId });
  }
  // Purchase mengikuti Deal dari verifikasi awal saja.
  if (outcome.isNewWin) queueCapiForStatus(id, 'deal');
  dispatch(async () => {
    await notifyPaymentVerified({
      prospect: { id, brandId, name: existing.name, userId: existing.userId },
      actor: req.user!, amount, paymentType: input.paymentType,
    });
    if (outcome.seatsTaken > 0 && existing.packageId) await notifyQuotaAfterBooking(existing.packageId, req.user!);
    if (custom) await notifyCustomDeal({ prospect: { id, brandId, name: existing.name, userId: existing.userId }, actor: req.user!, requestId: custom.id });
  });
  res.json({ success: true, data: outcome.prospect });
}));
