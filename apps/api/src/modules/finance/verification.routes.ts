import { Router } from 'express';
import type { ProspectStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { authGuard, requireRole, scopedBrandId } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/http.js';

export const verificationRouter = Router();
verificationRouter.use(authGuard, requireRole('finance', 'admin', 'superadmin'));

const CLOSED_STATUSES: ProspectStatus[] = ['deal', 'closed_won', 'lose', 'closed_lost'];
const PROOF_MESSAGE_TYPES = ['imageMessage', 'documentMessage'];
const MAX_CANDIDATES_PER_PROSPECT = 4;

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
} as const;

/**
 * Antrean kerja Finance lintas brand.
 * - `submitted`: bukti sudah diajukan (upload CS atau diambil dari chat) dan belum dipakai
 *   oleh pembayaran terverifikasi mana pun; hanya pembayaran awal sebelum Deal.
 * - `candidates`: invoice sudah terkirim, belum ada bukti yang diajukan, dan jamaah mengirim
 *   gambar/PDF setelah invoice (atau setelah pembayaran terakhir). Tidak otomatis dianggap
 *   bukti karena jamaah juga mengirim KTP/paspor; Finance atau CS mengonfirmasi dengan satu klik.
 */
verificationRouter.get('/queue', asyncHandler(async (req, res) => {
  const raw = req.query.brandId ? String(req.query.brandId) : 'all';
  const brandWhere = raw === 'all' ? {} : { brandId: scopedBrandId(req, Number(raw)) };

  const withProof = await prisma.prospect.findMany({
    where: { ...brandWhere, paymentProofUrl: { not: null }, status: { notIn: CLOSED_STATUSES } },
    select: prospectSelect,
    orderBy: { paymentProofSubmittedAt: 'asc' },
  });
  const submitted = withProof.filter((p) => !CLOSED_STATUSES.includes(p.status) && !p.payments.some((pay) => pay.proofUrl === p.paymentProofUrl));
  const submittedIds = new Set(submitted.map((p) => p.id));

  const billed = await prisma.prospect.findMany({
    where: {
      ...brandWhere,
      invoiceSentAt: { not: null },
      status: { notIn: CLOSED_STATUSES },
    },
    select: prospectSelect,
    orderBy: { invoiceSentAt: 'desc' },
    take: 300,
  });
  const pool = billed.filter((p) => !CLOSED_STATUSES.includes(p.status) && !submittedIds.has(p.id));

  // Gambar yang masuk sebelum invoice (atau sebelum pembayaran terakhir) bukan kandidat bukti.
  const sinceFor = (p: (typeof pool)[number]) => {
    const lastPayment = p.payments[0]?.createdAt;
    const from = lastPayment && p.invoiceSentAt && lastPayment > p.invoiceSentAt ? lastPayment : p.invoiceSentAt!;
    return Math.floor(from.getTime() / 1000);
  };
  const minSince = pool.length ? Math.min(...pool.map(sinceFor)) : 0;
  const media = pool.length
    ? await prisma.chatMessage.findMany({
        where: {
          prospectId: { in: pool.map((p) => p.id) },
          isFromMe: false,
          isDeleted: false,
          messageType: { in: PROOF_MESSAGE_TYPES },
          mediaUrl: { not: null },
          timestamp: { gte: minSince },
        },
        select: { id: true, prospectId: true, messageId: true, messageType: true, mediaUrl: true, messageText: true, timestamp: true },
        orderBy: { timestamp: 'desc' },
      })
    : [];

  const candidates = pool
    .map((p) => {
      const used = new Set([p.paymentProofMessageId, ...p.payments.map((pay) => pay.proofMessageId)].filter(Boolean));
      const since = sinceFor(p);
      const messages = media
        .filter((m) => m.prospectId === p.id && m.timestamp >= since && !used.has(m.messageId))
        .slice(0, MAX_CANDIDATES_PER_PROSPECT);
      return { ...p, candidateMessages: messages };
    })
    .filter((p) => p.candidateMessages.length > 0);

  const strip = <T extends { payments: unknown }>({ payments: _payments, ...rest }: T) => rest;
  res.json({
    success: true,
    data: {
      submitted: submitted.map(strip),
      candidates: candidates.map(strip),
    },
  });
}));
