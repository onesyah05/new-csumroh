import { Router } from 'express';
import { businessDateKey, wonStatuses } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { authGuard, scopedBrandId } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/http.js';
import { buildSummary, departures, parsePeriod, periodRange } from './summary.service.js';
import { tasksForCs, tasksForFinance, tasksForManager } from './tasks.service.js';

export const dashboardRouter = Router();
dashboardRouter.use(authGuard);

/**
 * Ringkasan bisnis per periode (lihat summary.service.ts untuk definisi angka). Pengawas holding
 * (superadmin/admin/finance) melihat semua brand bila brandId kosong atau 'all'; CS hanya melihat
 * prospek miliknya pada brand aktif.
 */
dashboardRouter.get('/', asyncHandler(async (req, res) => {
  const role = req.user!.role;
  const isHoldingRole = role === 'superadmin' || role === 'admin' || role === 'finance';
  const raw = req.query.brandId;
  const isHoldingView = isHoldingRole && (raw === 'all' || !raw);
  const currentBrandId = isHoldingView ? null : scopedBrandId(req, raw && raw !== 'all' ? Number(raw) : undefined);
  const isCs = role === 'cs';
  const range = periodRange(parsePeriod(req.query.period));

  const allBrands = await prisma.brand.findMany({ select: { id: true, name: true, logoUrl: true }, orderBy: { id: 'asc' } });
  const brands = currentBrandId ? allBrands.filter((b) => b.id === currentBrandId) : allBrands;
  const brandIds = brands.map((b) => b.id);
  const ownerFilter = isCs ? { userId: req.user!.id } : {};
  const today = new Date(`${businessDateKey()}T00:00:00.000Z`);

  const [prospects, csUsers, packages] = await Promise.all([
    prisma.prospect.findMany({
      where: { brandId: { in: brandIds }, ...ownerFilter, spamAt: null },
      select: {
        id: true, brandId: true, userId: true, status: true, leadSource: true, dealValue: true,
        dpPaidAt: true, createdAt: true, offerSentAt: true, invoiceSentAt: true,
        paxQuad: true, paxTriple: true, paxDouble: true, paxInfant: true,
      },
    }),
    prisma.user.findMany({
      where: { role: 'cs', OR: [{ brandId: { in: brandIds } }, { userBrands: { some: { brandId: { in: brandIds } } } }] },
      select: { id: true, name: true, isActive: true, brandId: true, userBrands: { select: { brandId: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.package.findMany({
      where: { brandId: { in: brandIds }, isActive: true, departureDate: { gte: today } },
      select: { id: true, name: true, quotaRemaining: true, departureDate: true, brand: { select: { name: true } } },
      orderBy: { departureDate: 'asc' },
      take: 5,
    }),
  ]);

  const sold = packages.length
    ? await prisma.prospect.groupBy({
      by: ['packageId'],
      where: { packageId: { in: packages.map((p) => p.id) }, status: { in: [...wonStatuses] } },
      _sum: { seatsReserved: true },
    })
    : [];
  const soldBy = new Map(sold.map((row) => [row.packageId, row._sum.seatsReserved ?? 0]));

  const summary = buildSummary({
    range,
    prospects,
    brands,
    users: csUsers.map((u) => ({
      id: u.id, name: u.name, isActive: u.isActive,
      brandIds: [...new Set([u.brandId, ...u.userBrands.map((ub) => ub.brandId)].filter((id): id is number => id !== null))],
    })),
    includeTeam: !isCs,
  });

  res.json({
    success: true,
    data: {
      scope: { isHoldingView, currentBrandId, role, brands: allBrands },
      ...summary,
      departures: departures(packages.map((p) => ({
        id: p.id, name: p.name, brandName: p.brand.name, departureDate: p.departureDate!,
        sold: soldBy.get(p.id) ?? 0, remaining: p.quotaRemaining,
      }))),
    },
  });
}));

// "Perlu dikerjakan sekarang" per role. CS: brand aktif (scope biasa). Pengawas holding: semua brand
// (brandId kosong/'all') atau satu brand yang dipilih di Ringkasan.
dashboardRouter.get('/tasks', asyncHandler(async (req, res) => {
  const role = req.user!.role;
  const raw = req.query.brandId;
  const isHoldingRole = role === 'superadmin' || role === 'admin' || role === 'finance';
  const brandIds = isHoldingRole && (!raw || raw === 'all')
    ? (await prisma.brand.findMany({ select: { id: true } })).map((b) => b.id)
    : [scopedBrandId(req, raw && raw !== 'all' ? Number(raw) : undefined)];
  const data = role === 'cs'
    ? await tasksForCs(req.user!, brandIds)
    : role === 'finance'
      ? await tasksForFinance(brandIds)
      : await tasksForManager(brandIds);
  res.json({ success: true, data });
}));
