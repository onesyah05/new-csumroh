import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { businessDateKey, canonicalStatus, isLostStatus, isWonStatus, objectionLabel } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { authGuard, requireRole, scopedBrandId } from '../../middleware/auth.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { toCsv } from '../../utils/csv.js';
import { fetchAdSpend } from './ad-spend.js';
import { fetchAdInsights } from '../ads/ad-insights.js';
import { SpamAudienceError, syncSpamAudience } from '../ads/spam-audience.js';
import { normalizePhone } from '../capi/capi.payload.js';

/**
 * Laporan manajemen (Superadmin & Admin): penjualan, kinerja CS, sumber lead, alasan batal, pembayaran, iklan Meta,
 * kreatif iklan; serta audiens spam untuk pengecualian iklan.
 * Periode memakai tanggal bisnis WIB; brand "all" = lintas brand (pengawas holding).
 * `format=csv` mengunduh tabel utama laporan.
 */
export const reportsRouter = Router();
reportsRouter.use(authGuard, requireRole('superadmin', 'admin'));

const STATUS_LABEL: Record<string, string> = {
  new: 'Baru', contact: 'Terhubung', qualified: 'Terkualifikasi', offer: 'Ditawarkan', objection: 'Keberatan',
  followup: 'Follow-up', closing: 'Tunggu verifikasi', deal: 'Deal', lose: 'Batal', nurture: 'Nurture',
};
const SOURCE_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', meta_ads: 'Meta Ads', website: 'Website', referral: 'Referral', walk_in: 'Walk-in' };

const rangeSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  brandId: z.string().default('all'),
  format: z.enum(['json', 'csv']).default('json'),
});

function parseRange(req: Request) {
  const input = rangeSchema.parse(req.query);
  const from = new Date(`${input.from}T00:00:00.000+07:00`);
  const to = new Date(`${input.to}T23:59:59.999+07:00`);
  const brandId = input.brandId === 'all' ? undefined : scopedBrandId(req, Number(input.brandId));
  return { ...input, range: { gte: from, lte: to }, brandId, brandWhere: brandId ? { brandId } : {} };
}

type Table = { header: string[]; rows: unknown[][] };
function send(res: Response, format: 'json' | 'csv', name: string, data: Record<string, unknown>, table: Table) {
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="laporan-${name}-${businessDateKey()}.csv"`);
    res.send(toCsv(table.header, table.rows));
    return;
  }
  res.json({ success: true, data });
}

/** Chat spam tidak dihitung sebagai lead di laporan mana pun. */
const notSpam = { spamAt: null };

const num = (value: unknown) => Number(value ?? 0) || 0;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
};
const stageKey = (status: string) => {
  const s = canonicalStatus(status);
  return isWonStatus(s) ? 'deal' : isLostStatus(s) ? 'lose' : s;
};

/** Deal = pembayaran pertama terverifikasi (tidak dibatalkan) dalam periode. */
async function dealsInRange(brandWhere: object, range: object) {
  return prisma.payment.findMany({
    where: { ...brandWhere, status: 'verified', createdAt: range },
    select: {
      amount: true, createdAt: true, bankName: true,
      prospect: {
        select: {
          id: true, createdAt: true, dealValue: true, paymentStatus: true, userId: true, leadSource: true,
          brand: { select: { name: true } }, package: { select: { name: true } }, user: { select: { name: true } },
        },
      },
    },
  });
}

// ── 1. Penjualan & funnel ────────────────────────────────────────────────────────────────────────────────
reportsRouter.get('/sales', asyncHandler(async (req, res) => {
  const { format, range, brandWhere } = parseRange(req);
  const [leads, spam, deals] = await Promise.all([
    prisma.prospect.findMany({ where: { ...brandWhere, createdAt: range, ...notSpam }, select: { status: true } }),
    prisma.prospect.count({ where: { ...brandWhere, createdAt: range, spamAt: { not: null } } }),
    dealsInRange(brandWhere, range),
  ]);

  // Posisi lead periode ini sekarang (per tahap).
  const byStage = new Map<string, number>();
  for (const lead of leads) byStage.set(stageKey(lead.status), (byStage.get(stageKey(lead.status)) ?? 0) + 1);
  const stages = ['new', 'contact', 'qualified', 'offer', 'objection', 'followup', 'closing', 'deal', 'lose', 'nurture']
    .map((key) => ({ key, label: STATUS_LABEL[key]!, count: byStage.get(key) ?? 0 }))
    .filter((s) => s.count > 0 || ['deal', 'lose'].includes(s.key));

  const dealValue = deals.reduce((sum, d) => sum + num(d.prospect.dealValue), 0);
  const cashIn = deals.reduce((sum, d) => sum + num(d.amount), 0);
  const days = deals.map((d) => (d.createdAt.getTime() - d.prospect.createdAt.getTime()) / 86_400_000).filter((v) => v >= 0);

  const group = (keyOf: (d: (typeof deals)[number]) => string) => {
    const map = new Map<string, { label: string; deals: number; value: number }>();
    for (const d of deals) {
      const label = keyOf(d);
      const entry = map.get(label) ?? { label, deals: 0, value: 0 };
      entry.deals += 1;
      entry.value += num(d.prospect.dealValue);
      map.set(label, entry);
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  };
  const byPackage = group((d) => d.prospect.package?.name ?? 'Layanan custom / tanpa paket');
  const byBrand = group((d) => d.prospect.brand.name);

  const summary = {
    leads: leads.length,
    spam,
    deals: deals.length,
    lost: byStage.get('lose') ?? 0,
    conversion: pct(deals.length, leads.length),
    dealValue,
    cashIn,
    avgDealValue: deals.length ? Math.round(dealValue / deals.length) : 0,
    avgDaysToDeal: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
  };
  send(res, format, 'penjualan', { summary, stages, byPackage, byBrand }, {
    header: ['Paket', 'Deal', 'Nilai deal'],
    rows: byPackage.map((r) => [r.label, r.deals, r.value]),
  });
}));

// ── 2. Kinerja CS ────────────────────────────────────────────────────────────────────────────────────────
reportsRouter.get('/cs', asyncHandler(async (req, res) => {
  const { format, range, brandId, brandWhere } = parseRange(req);
  const csUsers = await prisma.user.findMany({
    where: { role: 'cs', ...(brandId ? { OR: [{ brandId }, { userBrands: { some: { brandId } } }] } : {}) },
    select: { id: true, name: true, isActive: true },
    orderBy: { name: 'asc' },
  });
  const ids = csUsers.map((u) => u.id);
  const today = new Date(`${businessDateKey()}T00:00:00.000Z`);
  const [leads, deals, openNow, overdue, takeovers] = await Promise.all([
    prisma.prospect.findMany({ where: { ...brandWhere, createdAt: range, userId: { in: ids }, ...notSpam }, select: { id: true, userId: true } }),
    dealsInRange(brandWhere, range),
    prisma.prospect.groupBy({ by: ['userId'], where: { ...brandWhere, userId: { in: ids }, ...notSpam, status: { notIn: ['deal', 'closed_won', 'lose', 'closed_lost'] } }, _count: true }),
    prisma.prospect.groupBy({ by: ['userId'], where: { ...brandWhere, userId: { in: ids }, ...notSpam, status: { notIn: ['deal', 'closed_won', 'lose', 'closed_lost'] }, nextFollowupDate: { lt: today } }, _count: true }),
    prisma.prospectLog.findMany({ where: { actionType: 'pic_taken_over', createdAt: range, ...(brandId ? { prospect: { brandId } } : {}) }, select: { title: true } }),
  ]);

  // Waktu balas pertama: pesan jamaah pertama → balasan pertama sesudahnya (lead periode ini, menit kalender).
  const leadIds = leads.map((l) => l.id);
  const firstReply = leadIds.length ? await prisma.$queryRaw<{ prospect_id: number; first_in: number; first_out: number | null }[]>`
    SELECT fi.prospect_id, fi.first_in, MIN(o.timestamp) AS first_out
    FROM (
      SELECT prospect_id, MIN(timestamp) AS first_in FROM chat_messages
      WHERE prospect_id IN (${Prisma.join(leadIds)}) AND is_from_me = 0 AND is_deleted = 0
      GROUP BY prospect_id
    ) fi
    LEFT JOIN chat_messages o ON o.prospect_id = fi.prospect_id AND o.is_from_me = 1 AND o.timestamp >= fi.first_in
    GROUP BY fi.prospect_id, fi.first_in` : [];
  const replyByProspect = new Map(firstReply.filter((r) => r.first_out !== null).map((r) => [Number(r.prospect_id), (Number(r.first_out) - Number(r.first_in)) / 60]));

  const rows = csUsers.map((user) => {
    const myLeads = leads.filter((l) => l.userId === user.id);
    const myDeals = deals.filter((d) => d.prospect.userId === user.id);
    const replies = myLeads.map((l) => replyByProspect.get(l.id)).filter((m): m is number => typeof m === 'number');
    const lostToTakeover = takeovers.filter((t) => t.title.endsWith(` dari ${user.name}`)).length;
    return {
      id: user.id,
      name: user.name,
      isActive: user.isActive,
      leads: myLeads.length,
      deals: myDeals.length,
      dealValue: myDeals.reduce((sum, d) => sum + num(d.prospect.dealValue), 0),
      conversion: pct(myDeals.length, myLeads.length),
      medianReplyMinutes: median(replies.map((m) => Math.round(m))),
      takenOver: lostToTakeover,
      openNow: openNow.find((o) => o.userId === user.id)?._count ?? 0,
      overdueFollowups: overdue.find((o) => o.userId === user.id)?._count ?? 0,
    };
  }).filter((r) => r.isActive || r.leads || r.deals).sort((a, b) => b.dealValue - a.dealValue || b.deals - a.deals);

  send(res, format, 'kinerja-cs', { rows }, {
    header: ['CS', 'Lead baru', 'Deal', 'Nilai deal', 'Konversi (%)', 'Balas pertama (menit, median)', 'Diambil alih', 'Prospek aktif', 'Follow-up terlambat'],
    rows: rows.map((r) => [r.name, r.leads, r.deals, r.dealValue, r.conversion, r.medianReplyMinutes ?? '', r.takenOver, r.openNow, r.overdueFollowups]),
  });
}));

// ── 3. Sumber lead ───────────────────────────────────────────────────────────────────────────────────────
reportsRouter.get('/sources', asyncHandler(async (req, res) => {
  const { format, range, brandWhere } = parseRange(req);
  const leads = await prisma.prospect.findMany({ where: { ...brandWhere, createdAt: range }, select: { leadSource: true, status: true, dealValue: true, spamAt: true } });
  const map = new Map<string, { source: string; label: string; leads: number; spam: number; deals: number; lost: number; open: number; dealValue: number }>();
  for (const lead of leads) {
    const source = lead.leadSource || 'whatsapp';
    const entry = map.get(source) ?? { source, label: SOURCE_LABEL[source] ?? source, leads: 0, spam: 0, deals: 0, lost: 0, open: 0, dealValue: 0 };
    map.set(source, entry);
    // Spam dicatat terpisah: bukan lead, tetapi porsinya menunjukkan kualitas sumber.
    if (lead.spamAt) { entry.spam += 1; continue; }
    entry.leads += 1;
    if (isWonStatus(lead.status)) { entry.deals += 1; entry.dealValue += num(lead.dealValue); } else if (isLostStatus(lead.status)) entry.lost += 1;
    else entry.open += 1;
    map.set(source, entry);
  }
  const rows = [...map.values()].map((r) => ({ ...r, conversion: pct(r.deals, r.leads) })).sort((a, b) => b.leads - a.leads);
  send(res, format, 'sumber-lead', { rows, total: leads.filter((l) => !l.spamAt).length }, {
    header: ['Sumber', 'Lead', 'Spam', 'Deal', 'Batal', 'Masih berjalan', 'Konversi (%)', 'Nilai deal'],
    rows: rows.map((r) => [r.label, r.leads, r.spam, r.deals, r.lost, r.open, r.conversion, r.dealValue]),
  });
}));

// ── 4. Alasan batal & keberatan ─────────────────────────────────────────────────────────────────────────
reportsRouter.get('/lost', asyncHandler(async (req, res) => {
  const { format, range, brandId } = parseRange(req);
  const prospectScope = brandId ? { prospect: { brandId } } : {};
  const [lostLogs, objectionLogs] = await Promise.all([
    prisma.prospectLog.findMany({
      where: { actionType: 'status_changed', title: { in: ['Status menjadi lose', 'Status menjadi closed_lost'] }, createdAt: range, ...prospectScope },
      select: { prospectId: true, prospect: { select: { lostReason: true, status: true } } },
    }),
    prisma.prospectLog.findMany({
      where: { actionType: 'objection_logged', createdAt: range, ...prospectScope },
      select: { prospectId: true, prospect: { select: { objectionCategory: true, status: true } } },
    }),
  ]);
  // Satu prospek dihitung sekali (batal lalu diaktifkan & batal lagi tetap satu), hanya yang masih batal.
  const lost = new Map<number, string>();
  for (const log of lostLogs) if (isLostStatus(log.prospect.status)) lost.set(log.prospectId, log.prospect.lostReason?.trim() || 'Tanpa alasan');
  const reasonMap = new Map<string, number>();
  for (const reason of lost.values()) reasonMap.set(reason, (reasonMap.get(reason) ?? 0) + 1);
  const reasons = [...reasonMap.entries()].map(([reason, count]) => ({ reason, count, share: pct(count, lost.size) })).sort((a, b) => b.count - a.count);

  const objections = new Map<number, { category: string; won: boolean; lost: boolean }>();
  for (const log of objectionLogs) {
    objections.set(log.prospectId, { category: objectionLabel(log.prospect.objectionCategory), won: isWonStatus(log.prospect.status), lost: isLostStatus(log.prospect.status) });
  }
  const objMap = new Map<string, { category: string; count: number; won: number; lost: number }>();
  for (const o of objections.values()) {
    const entry = objMap.get(o.category) ?? { category: o.category, count: 0, won: 0, lost: 0 };
    entry.count += 1; if (o.won) entry.won += 1; if (o.lost) entry.lost += 1;
    objMap.set(o.category, entry);
  }
  const objectionRows = [...objMap.values()].map((o) => ({ ...o, winRate: pct(o.won, o.count) })).sort((a, b) => b.count - a.count);
  send(res, format, 'alasan-batal', { totalLost: lost.size, reasons, objections: objectionRows }, {
    header: ['Alasan batal', 'Jumlah', 'Porsi (%)'],
    rows: reasons.map((r) => [r.reason, r.count, r.share]),
  });
}));

// ── 5. Pembayaran ───────────────────────────────────────────────────────────────────────────────────────
reportsRouter.get('/payments', asyncHandler(async (req, res) => {
  const { format, range, brandWhere } = parseRange(req);
  const now = new Date();
  const [payments, reversed, rejected, invoices] = await Promise.all([
    dealsInRange(brandWhere, range),
    prisma.payment.count({ where: { ...brandWhere, status: 'reversed', createdAt: range } }),
    prisma.paymentProofRejection.count({ where: { ...brandWhere, kind: 'rejected', createdAt: range } }),
    // Invoice berjalan saat ini (belum Deal/Batal).
    prisma.prospect.findMany({
      where: { ...brandWhere, invoiceSentAt: { not: null }, status: { notIn: ['deal', 'closed_won', 'lose', 'closed_lost'] } },
      select: { invoiceAmount: true, invoiceDueAt: true, paymentProofUrl: true },
    }),
  ]);
  const full = payments.filter((p) => p.prospect.paymentStatus === 'paid_full');
  const dp = payments.filter((p) => p.prospect.paymentStatus !== 'paid_full');
  const bankMap = new Map<string, { bankName: string; count: number; amount: number }>();
  for (const p of payments) {
    const entry = bankMap.get(p.bankName) ?? { bankName: p.bankName, count: 0, amount: 0 };
    entry.count += 1; entry.amount += num(p.amount);
    bankMap.set(p.bankName, entry);
  }
  const brandMap = new Map<string, { brand: string; count: number; amount: number }>();
  for (const p of payments) {
    const entry = brandMap.get(p.prospect.brand.name) ?? { brand: p.prospect.brand.name, count: 0, amount: 0 };
    entry.count += 1; entry.amount += num(p.amount);
    brandMap.set(p.prospect.brand.name, entry);
  }
  const waitingProof = invoices.filter((i) => !i.paymentProofUrl);
  const summary = {
    count: payments.length,
    amount: payments.reduce((sum, p) => sum + num(p.amount), 0),
    dpCount: dp.length,
    dpAmount: dp.reduce((sum, p) => sum + num(p.amount), 0),
    fullCount: full.length,
    fullAmount: full.reduce((sum, p) => sum + num(p.amount), 0),
    reversed,
    rejected,
    openInvoices: invoices.length,
    openInvoiceAmount: invoices.reduce((sum, i) => sum + num(i.invoiceAmount), 0),
    overdueInvoices: waitingProof.filter((i) => i.invoiceDueAt && i.invoiceDueAt < now).length,
    waitingVerification: invoices.length - waitingProof.length,
  };
  const byBank = [...bankMap.values()].sort((a, b) => b.amount - a.amount);
  send(res, format, 'pembayaran', { summary, byBank, byBrand: [...brandMap.values()].sort((a, b) => b.amount - a.amount) }, {
    header: ['Bank', 'Jumlah pembayaran', 'Nominal'],
    rows: byBank.map((b) => [b.bankName, b.count, b.amount]),
  });
}));

// ── 6. Iklan Meta (CPL, CAC, ROAS) ───────────────────────────────────────────────────────────────────────
/**
 * Biaya iklan diambil dari Meta Insights per ad account brand. Lead & deal = prospek bersumber Meta Ads;
 * nilai purchase untuk ROAS = nilai deal (harga paket atau harga custom yang disepakati), bukan nominal DP/Lunas.
 */
reportsRouter.get('/ads', asyncHandler(async (req, res) => {
  const { format, from, to, range, brandId, brandWhere } = parseRange(req);
  const [brands, leads, deals] = await Promise.all([
    prisma.brand.findMany({
      where: brandId ? { id: brandId } : {},
      select: { id: true, name: true, metaAdAccountId: true, metaAccessToken: true },
      orderBy: { name: 'asc' },
    }),
    prisma.prospect.groupBy({ by: ['brandId'], where: { ...brandWhere, leadSource: 'meta_ads', createdAt: range, ...notSpam }, _count: true }),
    prisma.payment.findMany({
      where: { ...brandWhere, status: 'verified', createdAt: range, prospect: { leadSource: 'meta_ads' } },
      select: { brandId: true, prospect: { select: { dealValue: true } } },
    }),
  ]);
  const spends = await Promise.all(brands.map((brand) => fetchAdSpend(brand, from, to)));

  const rows = brands.map((brand, index) => {
    const ad = spends[index]!;
    const myDeals = deals.filter((d) => d.brandId === brand.id);
    const leadCount = leads.find((l) => l.brandId === brand.id)?._count ?? 0;
    const purchaseValue = myDeals.reduce((sum, d) => sum + num(d.prospect.dealValue), 0);
    // Rasio hanya dihitung bila biaya dalam Rupiah (sama dengan nilai deal).
    const spend = ad.status === 'ok' && ad.currency === 'IDR' ? ad.spend : null;
    return {
      brandId: brand.id,
      brand: brand.name,
      status: ad.status,
      message: ad.status === 'error' ? ad.message : ad.status === 'ok' && ad.currency !== 'IDR' ? `Mata uang ad account ${ad.currency}, bukan IDR.` : null,
      spend,
      leads: leadCount,
      deals: myDeals.length,
      purchaseValue,
      cpl: spend !== null && leadCount ? Math.round(spend / leadCount) : null,
      cac: spend !== null && myDeals.length ? Math.round(spend / myDeals.length) : null,
      roas: spend ? Math.round((purchaseValue / spend) * 100) / 100 : null,
    };
  });
  const measured = rows.filter((r) => r.spend !== null);
  const spend = measured.reduce((sum, r) => sum + r.spend!, 0);
  const totals = {
    spend,
    leads: measured.reduce((sum, r) => sum + r.leads, 0),
    deals: measured.reduce((sum, r) => sum + r.deals, 0),
    purchaseValue: measured.reduce((sum, r) => sum + r.purchaseValue, 0),
    measuredBrands: measured.length,
    brands: rows.length,
  };
  const summary = {
    ...totals,
    cpl: spend && totals.leads ? Math.round(spend / totals.leads) : null,
    cac: spend && totals.deals ? Math.round(spend / totals.deals) : null,
    roas: spend ? Math.round((totals.purchaseValue / spend) * 100) / 100 : null,
  };
  send(res, format, 'iklan-meta', { summary, rows }, {
    header: ['Brand', 'Biaya iklan', 'Lead Meta Ads', 'Deal', 'Nilai purchase', 'CPL', 'CAC', 'ROAS', 'Keterangan'],
    rows: rows.map((r) => [r.brand, r.spend ?? '', r.leads, r.deals, r.purchaseValue, r.cpl ?? '', r.cac ?? '', r.roas ?? '', r.status === 'not_configured' ? 'Ad account belum diatur' : r.message ?? '']),
  });
}));

// ── 7. Kreatif iklan (per iklan: metrik Meta + hasil CRM sampai ROAS) ─────────────────────────────────────
type AdOutcome = { prospect_id: number; brand_id: number; status: string; spam: number | bigint; ad_id: string | null };

/** ID iklan dari pesan pertama berreferral (Click-to-WhatsApp) per prospek. */
async function prospectAdIds(brandIds: number[], created?: { gte: Date; lte: Date }, prospectIds?: number[]) {
  if (!brandIds.length || (prospectIds && !prospectIds.length)) return [] as AdOutcome[];
  return prisma.$queryRaw<AdOutcome[]>`
    SELECT p.id AS prospect_id, p.brand_id, p.status, (p.spam_at IS NOT NULL) AS spam,
      JSON_UNQUOTE(JSON_EXTRACT(m.meta_referral_data, '$.adId')) AS ad_id
    FROM prospects p
    JOIN chat_messages m ON m.id = (
      SELECT MIN(cm.id) FROM chat_messages cm WHERE cm.prospect_id = p.id AND cm.meta_referral_data IS NOT NULL
    )
    WHERE p.brand_id IN (${Prisma.join(brandIds)})
      ${created ? Prisma.sql`AND p.created_at BETWEEN ${created.gte} AND ${created.lte}` : Prisma.empty}
      ${prospectIds ? Prisma.sql`AND p.id IN (${Prisma.join(prospectIds)})` : Prisma.empty}`;
}

/** Lead berkualitas: posisi saat ini sudah Terkualifikasi atau sesudahnya. */
const QUALIFIED_STAGES = new Set(['qualified', 'offer', 'objection', 'followup', 'closing', 'deal']);

export type CreativeRow = {
  adId: string; brand: string; adName: string; campaignName: string; thumbnailUrl: string | null;
  spend: number | null; impressions: number; clicks: number; ctr: number | null; conversations: number;
  leads: number; spam: number; qualified: number; deals: number; dealValue: number;
};

reportsRouter.get('/creatives', asyncHandler(async (req, res) => {
  const { format, from, to, range, brandId, brandWhere } = parseRange(req);
  const brands = await prisma.brand.findMany({
    where: brandId ? { id: brandId } : {},
    select: { id: true, name: true, metaAdAccountId: true, metaAccessToken: true },
    orderBy: { name: 'asc' },
  });
  const brandIds = brands.map((b) => b.id);
  const [insights, leads, payments] = await Promise.all([
    Promise.all(brands.map((brand) => fetchAdInsights(brand, from, to))),
    prospectAdIds(brandIds, range),
    prisma.payment.findMany({ where: { ...brandWhere, status: 'verified', createdAt: range }, select: { prospectId: true, prospect: { select: { dealValue: true } } } }),
  ]);
  const paidAds = await prospectAdIds(brandIds, undefined, payments.map((p) => p.prospectId));
  const adOfProspect = new Map(paidAds.map((r) => [Number(r.prospect_id), r.ad_id]));
  const brandName = new Map(brands.map((b) => [b.id, b.name]));

  const rows = new Map<string, CreativeRow>();
  const rowFor = (adId: string, brand: string) => {
    let row = rows.get(adId);
    if (!row) {
      row = { adId, brand, adName: `Iklan ${adId}`, campaignName: '', thumbnailUrl: null, spend: null, impressions: 0, clicks: 0, ctr: null, conversations: 0, leads: 0, spam: 0, qualified: 0, deals: 0, dealValue: 0 };
      rows.set(adId, row);
    }
    return row;
  };
  const brandStatus = brands.map((brand, index) => {
    const result = insights[index]!;
    if (result.status === 'ok') {
      for (const ad of result.ads) {
        Object.assign(rowFor(ad.adId, brand.name), {
          adName: ad.adName, campaignName: ad.campaignName, thumbnailUrl: ad.thumbnailUrl,
          // Rasio hanya bila biaya dalam Rupiah (sama dengan nilai deal).
          spend: ad.currency === 'IDR' ? ad.spend : null,
          impressions: ad.impressions, clicks: ad.clicks, ctr: ad.ctr, conversations: ad.conversations,
        });
      }
    }
    return { brandId: brand.id, brand: brand.name, status: result.status, message: result.status === 'error' ? result.message : null };
  });
  for (const lead of leads) {
    if (!lead.ad_id) continue;
    const row = rowFor(lead.ad_id, brandName.get(Number(lead.brand_id)) ?? '');
    if (Number(lead.spam)) { row.spam += 1; continue; }
    row.leads += 1;
    if (QUALIFIED_STAGES.has(stageKey(lead.status))) row.qualified += 1;
  }
  for (const payment of payments) {
    const adId = adOfProspect.get(payment.prospectId);
    if (!adId) continue;
    const row = rowFor(adId, '');
    row.deals += 1;
    row.dealValue += num(payment.prospect.dealValue);
  }
  const per = (spend: number | null, count: number) => (spend !== null && count ? Math.round(spend / count) : null);
  const list = [...rows.values()].map((r) => ({
    ...r,
    spamRate: pct(r.spam, r.leads + r.spam),
    costPerLead: per(r.spend, r.leads),
    costPerQualified: per(r.spend, r.qualified),
    costPerDeal: per(r.spend, r.deals),
    roas: r.spend ? Math.round((r.dealValue / r.spend) * 100) / 100 : null,
  })).sort((a, b) => (b.dealValue - a.dealValue) || ((b.spend ?? 0) - (a.spend ?? 0)) || (b.leads - a.leads));

  send(res, format, 'kreatif-iklan', { rows: list, brands: brandStatus }, {
    header: ['Brand', 'Kampanye', 'Iklan', 'ID iklan', 'Biaya', 'Impresi', 'CTR (%)', 'Percakapan (Meta)', 'Lead', 'Spam', 'Spam (%)', 'Terkualifikasi', 'Deal', 'Nilai deal', 'Biaya per lead', 'Biaya per lead terkualifikasi', 'Biaya per deal', 'ROAS'],
    rows: list.map((r) => [r.brand, r.campaignName, r.adName, r.adId, r.spend ?? '', r.impressions, r.ctr ?? '', r.conversations, r.leads, r.spam, r.spamRate, r.qualified, r.deals, r.dealValue, r.costPerLead ?? '', r.costPerQualified ?? '', r.costPerDeal ?? '', r.roas ?? '']),
  });
}));

// ── Audiens spam (pengecualian iklan) ──────────────────────────────────────────────────────────────────
reportsRouter.get('/spam-audience', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, z.coerce.number().int().positive().parse(req.query.brandId));
  const where = { brandId, spamAt: { not: null }, phone: { not: null } };
  if (req.query.format === 'csv') {
    // Nomor mentah untuk unggah manual di Ads Manager (Meta melakukan hash sendiri).
    const rows = await prisma.prospect.findMany({ where, select: { phone: true }, orderBy: { spamAt: 'desc' } });
    const phones = [...new Set(rows.map((r) => normalizePhone(r.phone!)))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="nomor-spam-${businessDateKey()}.csv"`);
    res.send(toCsv(['phone'], phones.map((p) => [p])));
    return;
  }
  const [brand, count] = await Promise.all([
    prisma.brand.findUniqueOrThrow({ where: { id: brandId }, select: { metaSpamAudienceId: true, metaSpamSyncedAt: true, metaAdAccountId: true, metaAccessToken: true } }),
    prisma.prospect.count({ where }),
  ]);
  res.json({
    success: true,
    data: { count, audienceId: brand.metaSpamAudienceId, syncedAt: brand.metaSpamSyncedAt, ready: Boolean(brand.metaAdAccountId && brand.metaAccessToken) },
  });
}));

reportsRouter.post('/spam-audience/sync', asyncHandler(async (req, res) => {
  const { brandId: requested } = z.object({ brandId: z.number().int().positive() }).parse(req.body);
  const brandId = scopedBrandId(req, requested);
  try {
    res.json({ success: true, data: await syncSpamAudience(brandId) });
  } catch (error) {
    if (error instanceof SpamAudienceError) throw new HttpError(422, error.message);
    throw error;
  }
}));
