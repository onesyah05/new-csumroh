import { Router } from 'express';
import { avatarNeedsRefresh, isWonStatus } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { authGuard, scopedBrandId } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/http.js';
import { refreshProspectAvatars } from '../chat/avatar.service.js';

export const dashboardRouter = Router();
dashboardRouter.use(authGuard);

dashboardRouter.get('/', asyncHandler(async (req, res) => {
  // Pengawas holding (superadmin/admin/finance) melihat semua brand bila brandId kosong atau 'all'.
  const isHoldingRole = req.user?.role === 'superadmin' || req.user?.role === 'admin' || req.user?.role === 'finance';
  const requestedBrandRaw = req.query.brandId;
  const isHoldingView = isHoldingRole && (requestedBrandRaw === 'all' || !requestedBrandRaw);

  let brandWhere: { brandId?: number } = {};
  let currentBrandId: number | undefined;

  if (!isHoldingView) {
    currentBrandId = scopedBrandId(
      req,
      requestedBrandRaw && requestedBrandRaw !== 'all' ? Number(requestedBrandRaw) : undefined
    );
    brandWhere = { brandId: currentBrandId };
  }

  // 1. Fetch all brands for multi-brand breakdown
  const allBrands = await prisma.brand.findMany({
    select: { id: true, name: true, code: true },
    orderBy: { id: 'asc' },
  });

  // 2. Fetch prospects from database (directly, not in-memory livechat cache - A14)
  const prospects = await prisma.prospect.findMany({
    where: brandWhere,
    select: {
      id: true,
      name: true,
      phone: true,
      city: true,
      status: true,
      photoUrl: true,
      remoteJid: true,
      paymentStatus: true,
      dealValue: true,
      dpAmount: true,
      paxQuad: true,
      paxTriple: true,
      paxDouble: true,
      paxInfant: true,
      brandId: true,
      userId: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, name: true } },
      package: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true, code: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  // 3. Compute core metrics
  const total = prospects.length;
  // Menang = booking Deal yang disahkan Finance. paymentStatus saja tidak cukup (booking bisa dibatalkan).
  const isWon = (p: typeof prospects[0]) => isWonStatus(p.status);

  const wonProspects = prospects.filter(isWon);
  const won = wonProspects.length;
  const unassigned = prospects.filter((p) => !p.userId).length;

  const totalPax = wonProspects.reduce(
    (sum, p) => sum + (p.paxQuad || 0) + (p.paxTriple || 0) + (p.paxDouble || 0) + (p.paxInfant || 0),
    0
  );

  const finance = summarizeFinance(prospects);
  const { dealValue: totalDealValue, verifiedCash: totalVerifiedCash, outstanding: totalOutstanding } = finance;

  // 4. Pipeline stages count & value
  const pipelineMap = new Map<string, { count: number; sum: number }>();
  for (const p of prospects) {
    const st = p.status;
    const cur = pipelineMap.get(st) || { count: 0, sum: 0 };
    cur.count++;
    cur.sum += Number(p.dealValue) || 0;
    pipelineMap.set(st, cur);
  }

  const pipeline = Array.from(pipelineMap.entries()).map(([status, val]) => ({
    status,
    _count: val.count,
    _sum: { dealValue: val.sum },
  }));

  // 5. Holding breakdown per brand
  const brandBreakdown = allBrands.map((b) => {
    const bProspects = prospects.filter((p) => p.brandId === b.id);
    const bWon = bProspects.filter(isWon);
    const bPax = bWon.reduce(
      (sum, p) => sum + (p.paxQuad || 0) + (p.paxTriple || 0) + (p.paxDouble || 0) + (p.paxInfant || 0),
      0
    );
    const bFinance = summarizeFinance(bProspects);

    return {
      id: b.id,
      name: b.name,
      code: b.code,
      totalLeads: bProspects.length,
      won: bWon.length,
      totalPax: bPax,
      dealValue: bFinance.dealValue,
      verifiedCash: bFinance.verifiedCash,
      outstanding: bFinance.outstanding,
      overpayment: bFinance.overpayment,
      cashOnCancelled: bFinance.cashOnCancelled,
      conversionRate: bProspects.length ? Math.round((bWon.length / bProspects.length) * 100) : 0,
    };
  });

  // 6. Active packages quota status
  const activePackages = await prisma.package.findMany({
    where: { ...brandWhere, isActive: true },
    select: {
      id: true,
      name: true,
      brandId: true,
      quotaRemaining: true,
      departureDate: true,
      departureInfo: true,
      price: true,
      brand: { select: { id: true, name: true, code: true } },
    },
    orderBy: { departureDate: 'asc' },
    take: 8,
  });

  // 7. WhatsApp status
  let waStatus: any = null;
  if (!isHoldingView && currentBrandId) {
    waStatus = await prisma.whatsappSession.findUnique({ where: { brandId: currentBrandId } });
  } else {
    const allWa = await prisma.whatsappSession.findMany({ select: { brandId: true, status: true, phoneNumber: true } });
    const connectedCount = allWa.filter((w) => w.status === 'connected').length;
    waStatus = {
      isHolding: true,
      totalChannels: allBrands.length,
      connectedChannels: connectedCount,
      status: connectedCount === allBrands.length ? 'connected' : connectedCount > 0 ? 'connecting' : 'disconnected',
      phoneNumber: `${connectedCount} dari ${allBrands.length} channel brand terhubung`,
    };
  }

  // 8. Recent 10 prospects
  const recent = prospects.slice(0, 10);

  // Foto profil WhatsApp disalin ke server di latar belakang (URL CDN WA kedaluwarsa, jadi tidak disimpan).
  const missingRecent = recent.filter((p) => avatarNeedsRefresh(p.photoUrl) && p.remoteJid && !p.remoteJid.endsWith('@g.us') && p.remoteJid !== '0@s.whatsapp.net');
  if (missingRecent.length > 0) {
    setImmediate(() => {
      void refreshProspectAvatars(missingRecent.map((p) => ({
        id: p.id, brandId: p.brandId, remoteJid: p.remoteJid, phone: p.phone, photoUrl: p.photoUrl,
      })));
    });
  }

  res.json({
    success: true,
    data: {
      isHoldingView,
      currentBrandId: currentBrandId ?? null,
      total,
      won,
      unassigned,
      totalPax,
      totalDealValue,
      totalVerifiedCash,
      totalOutstanding,
      totalOverpayment: finance.overpayment,
      cashOnCancelled: finance.cashOnCancelled,
      conversionRate: total ? Math.round((won / total) * 100) : 0,
      pipeline,
      brandBreakdown,
      activePackages,
      recent,
      wa: waStatus,
      brands: allBrands,
    },
  });
}));

type FinanceRow = { status: string; dealValue: unknown; dpAmount: unknown };

/**
 * Rekap keuangan per booking. Piutang dan kelebihan bayar dihitung per jamaah lalu dijumlah,
 * sehingga kelebihan bayar A tidak mengurangi piutang B. Kas pada booking yang dibatalkan
 * dilaporkan terpisah sebagai dana yang menunggu refund/pemindahan.
 */
export function summarizeFinance(rows: FinanceRow[]) {
  let dealValue = 0;
  let verifiedCash = 0;
  let outstanding = 0;
  let overpayment = 0;
  let cashOnCancelled = 0;
  for (const row of rows) {
    const value = Number(row.dealValue) || 0;
    const cash = Number(row.dpAmount) || 0;
    if (!isWonStatus(row.status)) {
      cashOnCancelled += cash;
      continue;
    }
    dealValue += value;
    verifiedCash += cash;
    outstanding += Math.max(0, value - cash);
    if (value > 0) overpayment += Math.max(0, cash - value);
  }
  return { dealValue, verifiedCash, outstanding, overpayment, cashOnCancelled };
}
