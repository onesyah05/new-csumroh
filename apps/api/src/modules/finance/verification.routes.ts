import { Router, type Request } from 'express';
import { z } from 'zod';
import { Prisma, type ProspectStatus } from '@prisma/client';
import {
  businessDateKey,
  customMinDpTotal,
  PAYMENT_HISTORY_STATUSES,
  paymentCorrectionSchema,
  paymentReversalSchema,
} from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { authGuard, requireRole, scopedBrandId } from '../../middleware/auth.js';
import { emitToBrand } from '../../realtime/socket.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { csvCell } from '../../utils/csv.js';

export const verificationRouter = Router();
verificationRouter.use(authGuard, requireRole('finance', 'admin', 'superadmin'));

const CLOSED_STATUSES: ProspectStatus[] = ['deal', 'closed_won', 'lose', 'closed_lost'];
const HISTORY_PAGE_SIZE = 50;
const HISTORY_MAX_ROWS = 5000;

const prospectSelect = {
  id: true,
  brandId: true,
  name: true,
  phone: true,
  status: true,
  invoiceAmount: true,
  invoiceNumber: true,
  invoiceSentAt: true,
  invoiceDueAt: true,
  dealValue: true,
  paymentProofUrl: true,
  paymentProofMessageId: true,
  paymentProofSubmittedAt: true,
  paxQuad: true,
  paxTriple: true,
  paxDouble: true,
  paxInfant: true,
  packageId: true,
  package: { select: { id: true, name: true } },
  user: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true, code: true } },
  payments: {
    select: { proofUrl: true, proofMessageId: true, createdAt: true },
    orderBy: { createdAt: 'desc' as const },
  },
  customRequests: {
    where: { status: 'agreed' as const },
    orderBy: { id: 'desc' as const },
    take: 1,
    select: { agreedPrice: true, minDpPerPax: true, minDpInfant: true, paxQuad: true, paxTriple: true, paxDouble: true, paxInfant: true },
  },
} as const;

type QueueRow = Prisma.ProspectGetPayload<{ select: typeof prospectSelect }>;

const brandWhereOf = (req: Request) => {
  const raw = req.query.brandId ? String(req.query.brandId) : 'all';
  return raw === 'all' ? {} : { brandId: scopedBrandId(req, Number(raw)) };
};

/** Awal hari (WIB) dari kunci YYYY-MM-DD. */
const wibStart = (key: string) => new Date(`${key}T00:00:00.000+07:00`);
const wibEnd = (key: string) => new Date(`${key}T23:59:59.999+07:00`);
const assertNotFuture = (date?: string | null) => {
  if (date && date > businessDateKey()) throw new HttpError(422, 'Tanggal mutasi tidak boleh di masa depan.');
};

/**
 * Antrean kerja Finance lintas brand.
 * `submitted`: bukti sudah diajukan (upload CS atau dikirim dari menu pesan chat) dan belum dipakai
 * oleh pembayaran terverifikasi mana pun; hanya pembayaran sebelum Deal.
 */
verificationRouter.get('/queue', asyncHandler(async (req, res) => {
  const brandWhere = brandWhereOf(req);

  const withProof = await prisma.prospect.findMany({
    where: { ...brandWhere, paymentProofUrl: { not: null }, status: { notIn: CLOSED_STATUSES } },
    select: prospectSelect,
    orderBy: { paymentProofSubmittedAt: 'asc' },
  });
  const submitted = withProof.filter((p) => !CLOSED_STATUSES.includes(p.status) && !p.payments.some((pay) => pay.proofUrl === p.paymentProofUrl));

  // Patokan pengecekan Finance: DP minimal & nilai deal layanan custom yang sudah disepakati.
  const shape = <T extends QueueRow>(row: T) => {
    const { payments: _payments, customRequests, ...rest } = row;
    const custom = customRequests[0];
    return {
      ...rest,
      customAgreedPrice: custom ? Number(custom.agreedPrice ?? 0) || null : null,
      customMinDp: custom ? customMinDpTotal(custom) : null,
    };
  };
  res.json({
    success: true,
    data: {
      submitted: submitted.map(shape),
    },
  });
}));

/** Ringkasan harian untuk Finance & manajemen (hari kerja WIB). */
verificationRouter.get('/summary', asyncHandler(async (req, res) => {
  const brandWhere = brandWhereOf(req);
  const todayStart = wibStart(businessDateKey());
  const monthAgo = new Date(Date.now() - 30 * 24 * 3_600_000);
  const [today, rejectedToday, recent] = await Promise.all([
    prisma.payment.aggregate({ where: { ...brandWhere, status: 'verified', createdAt: { gte: todayStart } }, _count: true, _sum: { amount: true } }),
    prisma.paymentProofRejection.count({ where: { ...brandWhere, kind: 'rejected', createdAt: { gte: todayStart } } }),
    prisma.payment.findMany({
      where: { ...brandWhere, createdAt: { gte: monthAgo } },
      select: { createdAt: true, prospect: { select: { paymentProofSubmittedAt: true } } },
      take: HISTORY_MAX_ROWS,
    }),
  ]);
  const waits = recent
    .map((p) => p.prospect.paymentProofSubmittedAt && p.createdAt.getTime() - p.prospect.paymentProofSubmittedAt.getTime())
    .filter((ms): ms is number => typeof ms === 'number' && ms >= 0);
  res.json({
    success: true,
    data: {
      verifiedToday: today._count,
      verifiedAmountToday: Number(today._sum.amount ?? 0),
      rejectedToday,
      avgVerifyMinutes: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length / 60_000) : null,
    },
  });
}));

const historyQuery = z.object({
  status: z.enum(PAYMENT_HISTORY_STATUSES).default('all'),
  from: z.string().date().optional().or(z.literal('')),
  to: z.string().date().optional().or(z.literal('')),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  format: z.enum(['json', 'csv']).default('json'),
});

type HistoryRow = {
  key: string;
  type: 'payment' | 'rejection';
  id: number;
  status: 'verified' | 'reversed' | 'rejected';
  at: Date;
  brand: { id: number; name: string; code: string };
  prospect: { id: number; name: string; phone: string | null; invoiceNumber: string | null; paymentStatus: string; status: string };
  amount: number | null;
  paymentType: 'dp' | 'full' | null;
  bankName: string | null;
  referenceNo: string | null;
  mutationDate: Date | null;
  notes: string | null;
  proofUrl: string | null;
  actor: string | null;
  reason: string | null;
  correctedAt: Date | null;
  reversedAt: Date | null;
  reversedBy: string | null;
};

const historyProspect = { select: { id: true, name: true, phone: true, invoiceNumber: true, paymentStatus: true, status: true } } as const;
const historyBrand = { select: { id: true, name: true, code: true } } as const;

async function loadHistory(req: Request) {
  const input = historyQuery.parse(req.query);
  const brandWhere = brandWhereOf(req);
  const createdAt = {
    ...(input.from ? { gte: wibStart(input.from) } : {}),
    ...(input.to ? { lte: wibEnd(input.to) } : {}),
  };
  const prospectMatch = input.q
    ? { OR: [{ name: { contains: input.q } }, { phone: { contains: input.q } }, { invoiceNumber: { contains: input.q } }] }
    : undefined;

  const wantPayments = input.status !== 'rejected';
  const wantRejections = input.status === 'all' || input.status === 'rejected';

  const [payments, rejections] = await Promise.all([
    wantPayments
      ? prisma.payment.findMany({
          where: {
            ...brandWhere,
            createdAt,
            ...(input.status === 'verified' || input.status === 'reversed' ? { status: input.status } : {}),
            ...(input.q ? { OR: [{ referenceNo: { contains: input.q } }, { prospect: prospectMatch }] } : {}),
          },
          include: { prospect: historyProspect, brand: historyBrand },
          orderBy: { createdAt: 'desc' },
          take: HISTORY_MAX_ROWS,
        })
      : [],
    wantRejections
      ? prisma.paymentProofRejection.findMany({
          where: { ...brandWhere, kind: 'rejected', createdAt, ...(prospectMatch ? { prospect: prospectMatch } : {}) },
          include: { prospect: historyProspect, brand: historyBrand, rejectedBy: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: HISTORY_MAX_ROWS,
        })
      : [],
  ]);

  const userIds = [...new Set(payments.flatMap((p) => [p.verifiedByUserId, p.reversedByUserId]).filter((id): id is number => Boolean(id)))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const nameOf = (id: number | null) => (id ? users.find((u) => u.id === id)?.name ?? null : null);

  const rows: HistoryRow[] = [
    ...payments.map((p): HistoryRow => ({
      key: `p${p.id}`, type: 'payment', id: p.id, status: p.status, at: p.createdAt, brand: p.brand, prospect: p.prospect,
      amount: Number(p.amount),
      // Satu pembayaran terverifikasi per prospek: jenisnya mengikuti status bayar prospek.
      paymentType: p.status === 'verified' ? (p.prospect.paymentStatus === 'paid_full' ? 'full' : 'dp') : null,
      bankName: p.bankName, referenceNo: p.referenceNo, mutationDate: p.mutationDate, notes: p.notes, proofUrl: p.proofUrl,
      actor: nameOf(p.verifiedByUserId), reason: p.reversalReason,
      correctedAt: p.correctedAt, reversedAt: p.reversedAt, reversedBy: nameOf(p.reversedByUserId),
    })),
    ...rejections.map((r): HistoryRow => ({
      key: `r${r.id}`, type: 'rejection', id: r.id, status: 'rejected', at: r.createdAt, brand: r.brand, prospect: r.prospect,
      amount: null, paymentType: null, bankName: null, referenceNo: null, mutationDate: null, notes: null, proofUrl: r.proofUrl,
      actor: r.rejectedBy?.name ?? null, reason: r.reason, correctedAt: null, reversedAt: null, reversedBy: null,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const verified = rows.filter((r) => r.status === 'verified');
  const byBank = new Map<string, { bankName: string; count: number; amount: number }>();
  for (const row of verified) {
    const entry = byBank.get(row.bankName!) ?? { bankName: row.bankName!, count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += row.amount ?? 0;
    byBank.set(row.bankName!, entry);
  }
  const totals = {
    verifiedCount: verified.length,
    verifiedAmount: verified.reduce((sum, r) => sum + (r.amount ?? 0), 0),
    rejectedCount: rows.filter((r) => r.status === 'rejected').length,
    reversedCount: rows.filter((r) => r.status === 'reversed').length,
    byBank: [...byBank.values()].sort((a, b) => b.amount - a.amount),
  };
  return { input, rows, totals };
}

const STATUS_LABEL = { verified: 'Terverifikasi', reversed: 'Dibatalkan', rejected: 'Ditolak' } as const;
const wibDateTime = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' });
/** Riwayat pembayaran terverifikasi, dibatalkan, dan bukti ditolak (terbaru di atas), atau CSV sesuai filter. */
verificationRouter.get('/history', asyncHandler(async (req, res) => {
  const { input, rows, totals } = await loadHistory(req);
  if (input.format === 'csv') {
    const header = ['Waktu (WIB)', 'Status', 'Brand', 'Jamaah', 'Telepon', 'No. invoice', 'Nominal', 'Jenis', 'Bank', 'No. referensi', 'Tanggal mutasi', 'Oleh', 'Alasan / catatan'];
    const lines = rows.map((r) => [
      wibDateTime.format(r.at), STATUS_LABEL[r.status], r.brand.name, r.prospect.name, r.prospect.phone, r.prospect.invoiceNumber,
      r.amount ?? '', r.paymentType === 'full' ? 'Lunas' : r.paymentType === 'dp' ? 'DP' : '',
      r.bankName, r.referenceNo, r.mutationDate ? r.mutationDate.toISOString().slice(0, 10) : '',
      r.status === 'reversed' ? `${r.actor ?? ''} · dibatalkan ${r.reversedBy ?? ''}` : r.actor,
      r.reason ?? r.notes,
    ].map(csvCell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="riwayat-verifikasi-${businessDateKey()}.csv"`);
    // BOM agar Excel membaca UTF-8.
    res.send(`﻿${[header.join(','), ...lines].join('\r\n')}`);
    return;
  }
  const start = (input.page - 1) * HISTORY_PAGE_SIZE;
  res.json({
    success: true,
    data: {
      items: rows.slice(start, start + HISTORY_PAGE_SIZE),
      page: input.page,
      pageSize: HISTORY_PAGE_SIZE,
      total: rows.length,
      totals,
    },
  });
}));

async function findPayment(req: Request) {
  const id = Number(req.params.id);
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { prospect: { select: { id: true, brandId: true, name: true, status: true, packageId: true, seatsReserved: true } } },
  });
  if (!payment) throw new HttpError(404, 'Pembayaran tidak ditemukan.');
  scopedBrandId(req, payment.brandId);
  if (payment.status !== 'verified') throw new HttpError(409, 'Pembayaran ini sudah dibatalkan.');
  return payment;
}

const rp = (value: unknown) => `Rp ${Number(value ?? 0).toLocaleString('id-ID')}`;
const dateKey = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : '-');

/** Superadmin: koreksi salah ketik (nominal, bank, referensi, tanggal mutasi). Nilai lama → baru tercatat di log. */
verificationRouter.patch('/payments/:id', requireRole('superadmin'), asyncHandler(async (req, res) => {
  const payment = await findPayment(req);
  const input = paymentCorrectionSchema.parse(req.body);
  const referenceNo = input.referenceNo?.trim() || null;
  const mutationDate = input.mutationDate || null;
  assertNotFuture(mutationDate);

  const changes = [
    Number(payment.amount) !== input.amount ? `Nominal: ${rp(payment.amount)} → ${rp(input.amount)}` : null,
    payment.bankName !== input.bankName ? `Bank: ${payment.bankName} → ${input.bankName}` : null,
    (payment.referenceNo ?? null) !== referenceNo ? `Ref: ${payment.referenceNo ?? '-'} → ${referenceNo ?? '-'}` : null,
    dateKey(payment.mutationDate) !== (mutationDate ?? '-') ? `Mutasi: ${dateKey(payment.mutationDate)} → ${mutationDate ?? '-'}` : null,
  ].filter(Boolean);
  if (!changes.length) throw new HttpError(422, 'Tidak ada data yang berubah.');

  try {
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          amount: input.amount,
          bankName: input.bankName,
          referenceNo,
          mutationDate: mutationDate ? new Date(`${mutationDate}T00:00:00.000Z`) : null,
          correctedAt: new Date(),
        },
      });
      const sum = await tx.payment.aggregate({ where: { prospectId: payment.prospectId, status: 'verified' }, _sum: { amount: true } });
      await tx.prospect.update({
        where: { id: payment.prospectId },
        data: {
          dpAmount: sum._sum.amount ?? 0,
          ...(mutationDate ? { dpPaidAt: new Date(`${mutationDate}T00:00:00.000Z`) } : {}),
        },
      });
      await tx.prospectLog.create({
        data: {
          prospectId: payment.prospectId,
          userId: req.user!.id,
          actionType: 'payment_corrected',
          title: 'Data pembayaran dikoreksi',
          description: [...changes, `Alasan: ${input.reason}`, `Oleh: ${req.user!.name}`].join(' · '),
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, `Nomor referensi mutasi ${referenceNo} sudah dipakai untuk pembayaran lain.`);
    }
    throw error;
  }
  const prospect = await prisma.prospect.findUnique({ where: { id: payment.prospectId } });
  if (prospect) emitToBrand(payment.brandId, 'prospect:updated', prospect);
  res.json({ success: true });
}));

/**
 * Superadmin: batalkan verifikasi yang keliru. Deal kembali ke Closing, kuota seat dikembalikan,
 * bukti dilepas agar CS meminta bukti yang benar. Event Purchase yang sudah terkirim ke Meta tidak ditarik.
 */
verificationRouter.post('/payments/:id/reverse', requireRole('superadmin'), asyncHandler(async (req, res) => {
  const payment = await findPayment(req);
  const { reason } = paymentReversalSchema.parse(req.body);
  const prospect = payment.prospect;
  if (prospect.status !== 'deal') {
    throw new HttpError(409, `Prospek berstatus ${prospect.status}; pembatalan verifikasi hanya untuk prospek Deal.`);
  }

  const seats = prospect.seatsReserved;
  await prisma.$transaction(async (tx) => {
    const reversed = await tx.payment.updateMany({
      where: { id: payment.id, status: 'verified' },
      data: { status: 'reversed', reversedAt: new Date(), reversedByUserId: req.user!.id, reversalReason: reason },
    });
    if (reversed.count !== 1) throw new HttpError(409, 'Pembayaran ini baru saja dibatalkan.');
    const reopened = await tx.prospect.updateMany({ where: { id: prospect.id, status: 'deal' }, data: { status: 'closing' } });
    if (reopened.count !== 1) throw new HttpError(409, 'Status prospek baru saja berubah. Muat ulang lalu coba lagi.');
    if (seats > 0 && prospect.packageId) {
      await tx.package.updateMany({ where: { id: prospect.packageId, quotaRemaining: { not: null } }, data: { quotaRemaining: { increment: seats } } });
    }
    const sum = await tx.payment.aggregate({ where: { prospectId: prospect.id, status: 'verified' }, _sum: { amount: true } });
    const remaining = Number(sum._sum.amount ?? 0);
    await tx.prospect.update({
      where: { id: prospect.id },
      data: {
        dpAmount: remaining,
        paymentStatus: remaining > 0 ? 'partial_dp' : 'unpaid',
        seatsReserved: 0,
        ...(remaining > 0 ? {} : { dpPaidAt: null, verifiedByUserId: null }),
        paymentProofUrl: null,
        paymentProofMessageId: null,
        paymentProofSubmittedAt: null,
      },
    });
    await tx.prospectLog.create({
      data: {
        prospectId: prospect.id,
        userId: req.user!.id,
        actionType: 'payment_reversed',
        title: `Verifikasi pembayaran ${rp(payment.amount)} dibatalkan`,
        description: [
          'Status kembali ke Closing',
          seats > 0 ? `Kuota dikembalikan: ${seats} seat` : null,
          `Alasan: ${reason}`,
          `Oleh: ${req.user!.name}`,
        ].filter(Boolean).join(' · '),
      },
    });
  });

  const updated = await prisma.prospect.findUnique({ where: { id: prospect.id } });
  if (updated) emitToBrand(payment.brandId, 'prospect:updated', updated);
  if (seats > 0 && prospect.packageId) emitToBrand(payment.brandId, 'package:quota_updated', { packageId: prospect.packageId });
  res.json({ success: true });
}));

