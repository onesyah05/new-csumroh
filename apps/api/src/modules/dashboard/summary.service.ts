import { isLostStatus, isWonStatus } from '@csumroh/shared-types';

/**
 * Ringkasan bisnis untuk satu periode: lead masuk, deal, nilai deal, corong lead,
 * performa brand dan CS. Fungsi di sini murni (tanpa database) agar definisi angkanya teruji.
 *
 * Definisi:
 * - Lead masuk  = prospek yang dibuat dalam periode (grup WhatsApp tidak dihitung).
 * - Deal        = booking yang disahkan Finance (`dpPaidAt`) dalam periode, apa pun tanggal lead-nya.
 * - Corong      = lead yang masuk dalam periode dan tahap terjauh yang sudah dicapai sekarang.
 */
export const periodKeys = ['this_month', 'last_month', 'last_30', 'this_year'] as const;
export type PeriodKey = typeof periodKeys[number];

const WIB_OFFSET = 7 * 3_600_000;
const DAY = 86_400_000;
/** Awal hari (00:00 WIB) untuk tanggal kalender WIB; bulan/tanggal di luar rentang digulung oleh Date.UTC. */
const wibStart = (year: number, month: number, day = 1) => new Date(Date.UTC(year, month, day) - WIB_OFFSET);

export type PeriodRange = { key: PeriodKey; from: Date; to: Date; prevFrom: Date; prevTo: Date; comparison: string };

export function parsePeriod(raw: unknown): PeriodKey {
  return periodKeys.includes(raw as PeriodKey) ? (raw as PeriodKey) : 'this_month';
}

/** Rentang periode [from, to) dan pembandingnya. Periode berjalan dibandingkan dengan rentang sepanjang yang sama. */
export function periodRange(key: PeriodKey, now = new Date()): PeriodRange {
  const wib = new Date(now.getTime() + WIB_OFFSET);
  const y = wib.getUTCFullYear();
  const m = wib.getUTCMonth();
  if (key === 'last_month') {
    return { key, from: wibStart(y, m - 1), to: wibStart(y, m), prevFrom: wibStart(y, m - 2), prevTo: wibStart(y, m - 1), comparison: 'bulan sebelumnya' };
  }
  if (key === 'last_30') {
    const from = new Date(now.getTime() - 30 * DAY);
    return { key, from, to: now, prevFrom: new Date(from.getTime() - 30 * DAY), prevTo: from, comparison: '30 hari sebelumnya' };
  }
  const from = key === 'this_year' ? wibStart(y, 0) : wibStart(y, m);
  const prevFrom = key === 'this_year' ? wibStart(y - 1, 0) : wibStart(y, m - 1);
  const elapsed = now.getTime() - from.getTime();
  const prevTo = new Date(Math.min(prevFrom.getTime() + elapsed, from.getTime()));
  return { key, from, to: now, prevFrom, prevTo, comparison: key === 'this_year' ? 'periode yang sama tahun lalu' : 'periode yang sama bulan lalu' };
}

export type SummaryProspect = {
  id: number; brandId: number; userId: number | null; status: string; leadSource: string;
  dealValue: unknown; dpPaidAt: Date | null; createdAt: Date;
  offerSentAt: Date | null; invoiceSentAt: Date | null;
  paxQuad: number; paxTriple: number; paxDouble: number; paxInfant: number;
};
export type SummaryUser = { id: number; name: string; isActive: boolean; brandIds: number[] };
export type SummaryBrand = { id: number; name: string };

const within = (at: Date | null, from: Date, to: Date) => Boolean(at) && at!.getTime() >= from.getTime() && at!.getTime() < to.getTime();
const num = (value: unknown) => Number(value) || 0;
/** Jamaah pada satu booking (termasuk infant); booking tanpa rincian pax dihitung satu jamaah. */
export const jamaahOf = (p: Pick<SummaryProspect, 'paxQuad' | 'paxTriple' | 'paxDouble' | 'paxInfant'>) =>
  Math.max(1, p.paxQuad + p.paxTriple + p.paxDouble + p.paxInfant);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Tahap terjauh yang dicapai prospek: 0 lead, 1 dibalas, 2 penawaran, 3 invoice, 4 deal. */
const STAGE_RANK: Record<string, number> = {
  new: 0, contact: 1, identifying: 1, qualified: 1, nurture: 1,
  offer: 2, offered: 2, objection: 2, followup: 2, closing: 3, deal: 4, closed_won: 4,
};
export function reachedStage(p: Pick<SummaryProspect, 'status' | 'offerSentAt' | 'invoiceSentAt'>) {
  // Prospek batal tetap dihitung sampai tahap yang pernah dilaluinya (jejak penawaran/invoice).
  const byStatus = isLostStatus(p.status) ? 1 : STAGE_RANK[p.status] ?? 0;
  const byTrace = p.invoiceSentAt ? 3 : p.offerSentAt ? 2 : 0;
  return Math.max(byStatus, byTrace);
}
export const FUNNEL_STAGES = ['Lead masuk', 'Dibalas CS', 'Dapat penawaran', 'Dapat invoice', 'Deal'] as const;

function sums(prospects: SummaryProspect[], from: Date, to: Date) {
  const leads = prospects.filter((p) => within(p.createdAt, from, to));
  const deals = prospects.filter((p) => isWonStatus(p.status) && within(p.dpPaidAt, from, to));
  return {
    leads: leads.length,
    deals: deals.length,
    jamaah: deals.reduce((sum, p) => sum + jamaahOf(p), 0),
    bookingValue: deals.reduce((sum, p) => sum + num(p.dealValue), 0),
    convertedLeads: leads.filter((p) => isWonStatus(p.status)).length,
  };
}

export function buildSummary(input: {
  range: PeriodRange; prospects: SummaryProspect[];
  brands: SummaryBrand[]; users: SummaryUser[]; includeTeam: boolean;
}) {
  const { range, brands, users } = input;
  // Grup WhatsApp bukan calon jamaah.
  const prospects = input.prospects.filter((p) => p.leadSource !== 'whatsapp_group');
  const current = sums(prospects, range.from, range.to);
  const previous = sums(prospects, range.prevFrom, range.prevTo);

  const cohort = prospects.filter((p) => within(p.createdAt, range.from, range.to));
  const ranks = cohort.map(reachedStage);
  const funnel = {
    stages: FUNNEL_STAGES.map((label, index) => ({ label, count: ranks.filter((r) => r >= index).length })),
    lost: cohort.filter((p) => isLostStatus(p.status)).length,
    conversion: pct(current.convertedLeads, current.leads),
    sources: [...new Set(cohort.map((p) => p.leadSource))]
      .map((source) => {
        const rows = cohort.filter((p) => p.leadSource === source);
        return { source, leads: rows.length, deals: rows.filter((p) => isWonStatus(p.status)).length };
      })
      .sort((a, b) => b.leads - a.leads),
  };

  const brandRows = brands.map((brand) => {
    const own = prospects.filter((p) => p.brandId === brand.id);
    const stats = sums(own, range.from, range.to);
    return {
      id: brand.id, name: brand.name, ...stats,
      conversion: pct(stats.convertedLeads, stats.leads),
      activeCs: users.filter((u) => u.isActive && u.brandIds.includes(brand.id)).length,
      unassignedOpen: own.filter((p) => !p.userId && !isWonStatus(p.status) && !isLostStatus(p.status)).length,
    };
  });

  const team = input.includeTeam
    ? users
      .map((user) => {
        const own = prospects.filter((p) => p.userId === user.id);
        const stats = sums(own, range.from, range.to);
        return {
          id: user.id, name: user.name, isActive: user.isActive,
          brands: brands.filter((b) => user.brandIds.includes(b.id)).map((b) => b.name),
          ...stats,
          conversion: pct(stats.convertedLeads, stats.leads),
          openNow: own.filter((p) => !isWonStatus(p.status) && !isLostStatus(p.status)).length,
        };
      })
      // CS nonaktif hanya tampil bila masih punya angka pada periode ini.
      .filter((row) => row.isActive || row.leads > 0 || row.deals > 0)
      .sort((a, b) => b.bookingValue - a.bookingValue || b.deals - a.deals || b.leads - a.leads)
    : null;

  return {
    period: { key: range.key, from: range.from, to: range.to, prevFrom: range.prevFrom, prevTo: range.prevTo, comparison: range.comparison },
    kpis: {
      leads: { value: current.leads, previous: previous.leads },
      deals: { value: current.deals, previous: previous.deals, jamaah: current.jamaah },
      bookingValue: { value: current.bookingValue, previous: previous.bookingValue },
    },
    funnel,
    brands: brandRows,
    team,
  };
}

export type DepartureRow = { id: number; name: string; brandName: string; departureDate: Date; sold: number; remaining: number | null };

/** Keberangkatan terdekat: seat terjual (booking Deal) terhadap kapasitas (terjual + sisa kuota). */
export function departures(rows: DepartureRow[], now = new Date()) {
  return rows.map((row) => ({
    ...row,
    capacity: row.remaining === null ? null : row.remaining + row.sold,
    daysLeft: Math.max(0, Math.ceil((row.departureDate.getTime() - WIB_OFFSET - now.getTime()) / DAY)),
  }));
}
