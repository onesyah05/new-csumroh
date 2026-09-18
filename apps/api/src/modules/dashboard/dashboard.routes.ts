import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { authGuard, scopedBrandId } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/http.js';

export const dashboardRouter = Router();
dashboardRouter.use(authGuard);
dashboardRouter.get('/', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const [total, won, unassigned, pipeline, recent, wa] = await Promise.all([
    prisma.prospect.count({ where: { brandId } }),
    prisma.prospect.count({ where: { brandId, status: 'closed_won' } }),
    prisma.prospect.count({ where: { brandId, userId: null } }),
    prisma.prospect.groupBy({ by: ['status'], where: { brandId }, _count: true, _sum: { dealValue: true } }),
    prisma.prospect.findMany({ where: { brandId }, include: { user: { select: { name: true } } }, orderBy: { updatedAt: 'desc' }, take: 5 }),
    prisma.whatsappSession.findUnique({ where: { brandId } }),
  ]);
  res.json({ success: true, data: { total, won, unassigned, conversionRate: total ? Math.round((won / total) * 100) : 0, pipeline, recent, wa } });
}));
