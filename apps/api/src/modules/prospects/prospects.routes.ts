import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { Prisma, ProspectStatus as DbProspectStatus, PaymentStatus } from '@prisma/client';
import {
  businessDateKey,
  canTransitionStatus,
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

export const prospectsRouter = Router();
prospectsRouter.use(authGuard);

const include = {
  user: { select: { id: true, name: true } },
  package: { select: { id: true, name: true, departureDate: true } },
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
      logs: {
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      },
      messages: { orderBy: { timestamp: 'asc' } },
      payments: {
        select: { id: true, amount: true, bankName: true, referenceNo: true, mutationDate: true, status: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
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
  if (isCancellingDeal && !FINANCE_ROLES.includes(req.user!.role)) {
    throw new HttpError(403, 'Pembatalan booking Deal hanya dapat dilakukan Finance atau Admin.');
  }

  // Action-driven pipeline validation: enforce criteria for each stage transition
  if (status === 'contact') {
    const outboundCount = await prisma.chatMessage.count({
      where: { prospectId: existing.id, isFromMe: true },
    });
    if (outboundCount === 0) {
      throw new HttpError(422, 'Tahap Kontak dicapai otomatis setelah CS mengirimkan minimal 1 pesan balasan ke prospek.');
    }
  }

  if (status === 'qualified') {
    const totalPax = (existing.paxQuad ?? 0) + (existing.paxTriple ?? 0) + (existing.paxDouble ?? 0) + (existing.paxInfant ?? 0);
    if (!existing.targetMonth || !existing.roomPreference || totalPax <= 0) {
      throw new HttpError(422, 'Tahap Terkualifikasi memerlukan Target Bulan, Tipe Kamar, dan minimal 1 Pax terisi pada profil.');
    }
  }

  if (status === 'offer' && !existing.offerSentAt) {
    throw new HttpError(422, 'Tahap Penawaran (Offer) hanya dapat diaktifkan melalui fitur "Kirim Penawaran Resmi".');
  }

  if (status === 'closing' && !existing.invoiceSentAt) {
    throw new HttpError(422, 'Tahap Closing hanya dapat diaktifkan setelah Invoice DP benar-benar terkirim ke jamaah.');
  }

  const isNewLost = isLose && !isLostStatus(existing.status);

  const { prospect, seatsReleased } = await prisma.$transaction(async (tx) => {
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
    const cash = Number(existing.dpAmount) || 0;
    await tx.prospectLog.create({
      data: {
        prospectId: existing.id,
        userId: req.user!.id,
        actionType: isCancellingDeal ? 'booking_cancelled' : 'status_changed',
        title: isCancellingDeal ? 'Booking Deal dibatalkan' : `Status menjadi ${status}`,
        description: [
          isNewLost && lostReason ? `Dari ${existing.status} — Alasan: ${lostReason}` : `Dari ${existing.status}`,
          released > 0 ? `Seat dikembalikan ke kuota: ${released}` : null,
          isCancellingDeal && cash > 0 ? `Dana terverifikasi Rp ${cash.toLocaleString('id-ID')} memerlukan proses refund/pemindahan oleh Finance` : null,
        ].filter(Boolean).join(' · '),
      },
    });
    return { prospect: updated, seatsReleased: released };
  });

  emitToBrand(brandId, 'prospect:updated', prospect);
  if (seatsReleased > 0 && existing.packageId) {
    emitToBrand(brandId, 'package:quota_updated', { packageId: existing.packageId });
  }
  if (existing.status !== status) queueCapiForStatus(prospect.id, status);
  res.json({ success: true, data: prospect });
}));

prospectsRouter.post('/:id/claim', asyncHandler(async (req, res) => {
  if (req.user!.role !== 'cs') throw new HttpError(403, 'Hanya CS yang dapat menjadi PIC.');
  const id = Number(req.params.id);
  const brandId = await resolveProspectBrand(req, id);
  const result = await prisma.prospect.updateMany({
    where: { id, brandId, userId: null },
    data: { userId: req.user!.id },
  });
  if (result.count === 0) throw new HttpError(409, 'Prospek sudah diklaim CS lain atau tidak ditemukan.');
  await prisma.prospectLog.create({
    data: { prospectId: id, userId: req.user!.id, actionType: 'pic_claimed', title: `PIC diklaim oleh ${req.user!.name}` },
  });
  const prospect = await prisma.prospect.findUniqueOrThrow({ where: { id }, include });
  emitToBrand(brandId, 'prospect:claimed', prospect);
  res.json({ success: true, data: prospect });
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
  const { id, brandId } = await findScopedProspect(req);

  const targetUserId = req.body.userId ? Number(req.body.userId) : null;
  let targetUser = null;
  if (targetUserId) {
    targetUser = await findEligiblePic(targetUserId, brandId);
    if (!targetUser) throw new HttpError(400, 'User target bukan CS aktif yang memiliki akses ke brand ini.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.prospect.update({
      where: { id },
      data: { userId: targetUserId },
      include,
    });

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

  emitToBrand(brandId, 'prospect:claimed', updated);
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

  let targetUser = null;
  if (targetUserId) {
    targetUser = await findEligiblePic(targetUserId, brandId);
    if (!targetUser) throw new HttpError(400, 'User target bukan CS aktif yang memiliki akses ke brand ini.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.prospect.update({
      where: { id },
      data: { userId: targetUserId ?? null },
      include,
    });

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

  emitToBrand(brandId, 'prospect:claimed', updated);
  emitToBrand(brandId, 'prospect:updated', updated);
  res.json({ success: true, data: updated });
}));

prospectsRouter.patch('/:id/profile', asyncHandler(async (req, res) => {
  const { id, brandId, existing } = await findScopedProspect(req);

  // Settlement (nilai booking, kas, status bayar) tidak pernah diubah lewat profil.
  // Payload yang membawa nilai sama persis dengan data tersimpan dianggap tidak mengubah apa pun.
  const attempted = settlementFields.filter(
    (field) => req.body?.[field] !== undefined && !sameSettlementValue(field, req.body[field], existing[field]),
  );
  if (attempted.length > 0) {
    throw new HttpError(403, 'Nilai transaksi dan status pembayaran hanya dapat diubah melalui penawaran resmi dan verifikasi Finance.');
  }

  const input = prospectProfileSchema.parse(req.body);

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

  const { nextFollowupDate, packageId, ...rest } = input;
  const data: Prisma.ProspectUncheckedUpdateInput = { ...rest };
  if (nextFollowupDate !== undefined) {
    const key = dateOnlyKey(nextFollowupDate);
    data.nextFollowupDate = key ? new Date(`${key}T00:00:00.000Z`) : null;
  }
  if (packageId !== undefined) data.packageId = packageId;

  // Auto-promote Trigger 2: contact / new -> qualified
  const totalPax = (input.paxQuad ?? existing.paxQuad ?? 0) +
                   (input.paxTriple ?? existing.paxTriple ?? 0) +
                   (input.paxDouble ?? existing.paxDouble ?? 0) +
                   (input.paxInfant ?? existing.paxInfant ?? 0);
  const targetMonth = input.targetMonth ?? existing.targetMonth;
  const roomPref = input.roomPreference ?? existing.roomPreference;
  const isQualifiedNow = Boolean(targetMonth && roomPref && totalPax > 0);

  let promotedToQualified = false;
  if (isQualifiedNow && ['new', 'contact', 'identifying'].includes(existing.status)) {
    data.status = 'qualified';
    promotedToQualified = true;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.prospect.update({ where: { id }, data, include });
    await tx.prospectLog.create({
      data: {
        prospectId: id,
        userId: req.user!.id,
        actionType: promotedToQualified ? 'status_changed' : 'profile_updated',
        title: promotedToQualified ? 'Status otomatis menjadi Terkualifikasi (qualified)' : 'Profil prospek diperbarui',
        description: promotedToQualified ? `Form kualifikasi lengkap: ${targetMonth}, ${totalPax} pax, ${roomPref}` : undefined,
      },
    });
    return p;
  });

  emitToBrand(brandId, 'prospect:updated', updated);
  res.json({ success: true, data: updated });
}));

// Trigger 3: Send Official Offer -> offer
prospectsRouter.post('/:id/offer', asyncHandler(async (req, res) => {
  const { id, brandId, existing } = await findScopedProspect(req);
  const input = offerInputSchema.parse(req.body);

  if (isWonStatus(existing.status)) {
    throw new HttpError(409, 'Booking sudah Deal; nilai dan paket terkunci. Revisi booking melalui Finance/Admin.');
  }

  const pkg = await prisma.package.findFirst({ where: { id: input.packageId, brandId } });
  if (!pkg) throw new HttpError(404, 'Paket umroh tidak ditemukan.');

  // Nilai penawaran = harga katalog × pax. Override (diskon) hanya oleh admin/finance dan tercatat di log.
  const catalogValue = packageBookingValue(pkg, existing);
  const canOverride = FINANCE_ROLES.includes(req.user!.role);
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
      logTitle: `Naskah penawaran ${pkg.name} dikirim oleh ${req.user!.name}`,
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
        packageId: pkg.id,
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
        title: sent ? `Penawaran resmi terkirim: ${pkg.name}` : `Draft penawaran disiapkan: ${pkg.name}`,
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
  const typeLabel: Record<string, string> = { call: 'Telepon', whatsapp: 'WhatsApp', meeting: 'Pertemuan', email: 'Email', note: 'Catatan' };
  // Booking Deal/Lose tetap bisa dijadwalkan follow-up (mis. pelunasan) tanpa mengubah tahapnya.
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
  // Klien lama mengirim nominal tagihan sebagai `dpAmount`; diterima sebagai alias tagihan, bukan kas.
  const input = invoiceInputSchema.parse({ invoiceAmount: req.body?.dpAmount, ...req.body });
  const isWon = isWonStatus(existing.status);

  if (isWon && input.packageId && input.packageId !== existing.packageId) {
    throw new HttpError(409, 'Paket booking Deal terkunci. Revisi booking melalui Finance/Admin.');
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
    const p = await tx.prospect.update({
      where: { id },
      data: {
        paymentProofUrl: fileUrl,
        paymentProofMessageId: source?.messageId ?? null,
        paymentProofSubmittedAt: new Date(),
      },
      include,
    });

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
  return updated;
}

// Legacy: tautkan ulang berkas privat yang sudah diunggah. Data URL / URL bebas ditolak (A06).
prospectsRouter.post('/:id/payment-proof', asyncHandler(async (req, res) => {
  const { id, brandId, existing } = await findScopedProspect(req);
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
    select: { brandId: true, paymentProofUrl: true, payments: { where: { proofUrl: fileUrl }, select: { id: true }, take: 1 } },
  });
  if (!owner || (owner.paymentProofUrl !== fileUrl && owner.payments.length === 0)) {
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
// Setiap verifikasi = satu baris ledger. Kas kumulatif (dpAmount) = jumlah seluruh mutasi.
// Kemenangan (Deal) & pemotongan seat hanya dilakukan oleh request yang benar-benar
// mengubah status menjadi deal (conditional update), sehingga approval paralel aman.
prospectsRouter.post('/:id/verify-payment', asyncHandler(async (req, res) => {
  if (!FINANCE_ROLES.includes(req.user!.role)) {
    throw new HttpError(403, 'Hanya tim Finance atau Admin yang dapat memvalidasi pembayaran.');
  }
  const { id, brandId, existing } = await findScopedProspect(req);
  const input = paymentVerifySchema.parse(req.body);
  const amount = Number(input.approvedAmount);
  const referenceNo = input.referenceNo?.trim() || null;
  const mutationDate = input.mutationDate || null;

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

  const seatCount = seatCountFor(existing);

  let outcome: { prospect: Awaited<ReturnType<typeof prisma.prospect.update>>; isNewWin: boolean; seatsTaken: number; isPaidFull: boolean; total: number };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      // Atomic claim of the win: only one concurrent request can flip a non-deal row to deal.
      const win = await tx.prospect.updateMany({
        where: { id, brandId, status: { notIn: WON_STATUSES } },
        data: { status: 'deal', closedWonCount: { increment: 1 } },
      });
      const isNewWin = win.count === 1;

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
          dpAmount: { increment: amount },
          verifiedByUserId: req.user!.id,
          ...(bookingValue !== Number(existing.dealValue) ? { dealValue: bookingValue } : {}),
          ...(isNewWin ? { dpPaidAt: mutationDate ? new Date(`${mutationDate}T00:00:00.000Z`) : new Date(), seatsReserved: seatsTaken } : {}),
        },
        select: { dpAmount: true, dealValue: true },
      });
      const total = Number(afterCash.dpAmount);
      const isPaidFull = Number(afterCash.dealValue) > 0 && total >= Number(afterCash.dealValue);
      const paymentStatus: PaymentStatus = isPaidFull ? 'paid_full' : 'partial_dp';

      const p = await tx.prospect.update({ where: { id }, data: { paymentStatus }, include });

      await tx.prospectLog.create({
        data: {
          prospectId: id,
          userId: req.user!.id,
          actionType: 'payment_verified',
          title: `${isPaidFull ? 'Pelunasan' : isNewWin ? 'Pembayaran DP' : 'Pembayaran lanjutan'} diverifikasi Finance: Rp ${amount.toLocaleString('id-ID')}`,
          description: [
            `Bank: ${input.bankName}`,
            referenceNo ? `Ref: ${referenceNo}` : null,
            mutationDate ? `Mutasi: ${mutationDate}` : null,
            `Total kas terverifikasi: Rp ${total.toLocaleString('id-ID')} dari Rp ${Number(afterCash.dealValue).toLocaleString('id-ID')}`,
            isNewWin ? `Kuota terpakai: ${seatsTaken || seatCount} seat` : null,
            input.notes ? `Catatan: ${input.notes}` : null,
            `Oleh: ${req.user!.name}`,
          ].filter(Boolean).join(' · '),
        },
      });

      return { prospect: p, isNewWin, seatsTaken, isPaidFull, total };
    });
  } catch (error) {
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
  // Purchase hanya untuk kemenangan baru; pelunasan tidak menjadi transaksi revenue kedua.
  if (outcome.isNewWin) queueCapiForStatus(id, 'deal');
  res.json({ success: true, data: outcome.prospect });
}));
