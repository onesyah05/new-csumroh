import { ImageOff, Trophy } from 'lucide-react';
import { resolveMediaUrl } from '../../lib/api';
import { cn } from '../../lib/cn';
import { EmptyState } from '../../components/ui/page-feedback';
import { rupiah } from '../finance/verificationApi';

export type CreativeRow = {
  adId: string; brand: string; adName: string; campaignName: string; thumbnailUrl: string | null;
  spend: number | null; impressions: number; clicks: number; ctr: number | null; conversations: number;
  leads: number; spam: number; spamRate: number; qualified: number; deals: number; dealValue: number;
  costPerLead: number | null; costPerQualified: number | null; costPerDeal: number | null; roas: number | null;
};
export type CreativesReport = {
  rows: CreativeRow[];
  brands: { brandId: number; brand: string; status: 'ok' | 'not_configured' | 'error'; message: string | null }[];
};

const num = (value: number) => new Intl.NumberFormat('id-ID').format(value);
const money = (value: number | null) => (value === null ? '—' : rupiah(value));
export const roasText = (value: number | null) => (value === null ? '—' : `${value.toLocaleString('id-ID', { maximumFractionDigits: 2 })}×`);

/**
 * Konten winning: sudah menghasilkan deal, ROAS minimal balik modal (≥ 1×), dan ROAS-nya setara atau di atas
 * ROAS gabungan semua iklan terukur pada periode itu. Tanpa data biaya dari Meta, tidak ada yang ditandai.
 */
export function winningAdIds(rows: Pick<CreativeRow, 'adId' | 'spend' | 'deals' | 'dealValue' | 'roas'>[]) {
  const measured = rows.filter((r) => r.spend);
  const spend = measured.reduce((sum, r) => sum + r.spend!, 0);
  if (!spend) return new Set<string>();
  const overall = measured.reduce((sum, r) => sum + r.dealValue, 0) / spend;
  return new Set(measured.filter((r) => r.deals > 0 && r.roas !== null && r.roas >= 1 && r.roas >= overall).map((r) => r.adId));
}

export function WinningBadge() {
  return (
    <span
      title="Winning: menghasilkan deal dengan ROAS di atas rata-rata semua iklan periode ini"
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900"
    >
      <Trophy size={11} aria-hidden="true" />Winning
    </span>
  );
}

export function CreativeThumb({ row, size = 'md' }: { row: Pick<CreativeRow, 'thumbnailUrl' | 'adName'>; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-10 w-10' : 'h-14 w-14';
  return row.thumbnailUrl ? (
    <img src={resolveMediaUrl(row.thumbnailUrl)} alt="" loading="lazy" className={cn(box, 'shrink-0 rounded-lg border border-zinc-200 bg-zinc-100 object-cover')} />
  ) : (
    <span className={cn(box, 'grid shrink-0 place-items-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-400')} aria-hidden="true"><ImageOff size={16} /></span>
  );
}

/** Per iklan: metrik Meta (biaya, impresi, CTR, percakapan) + hasil CRM (lead, spam, terkualifikasi, deal, ROAS). */
export function CreativesView({ data }: { data: CreativesReport }) {
  const issues = data.brands.filter((b) => b.status !== 'ok');
  const winning = winningAdIds(data.rows);
  return (
    <div className="space-y-3">
      {issues.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {issues.map((b) => (
            <li key={b.brandId}><b className="font-semibold">{b.brand}</b>: {b.status === 'not_configured' ? 'Ad account belum diatur; hanya data CRM yang tampil.' : b.message}</li>
          ))}
        </ul>
      )}
      {data.rows.length === 0 ? (
        <EmptyState icon={ImageOff} title="Belum ada data iklan" description="Tidak ada iklan berjalan atau chat dari iklan pada periode ini." />
      ) : (
        <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white" aria-label="Kreatif iklan">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-xs text-zinc-500">
                  <th scope="col" className="px-4 py-2 text-left font-medium">Iklan</th>
                  {['Biaya', 'Impresi', 'CTR', 'Percakapan', 'Lead', 'Spam', 'Terkualifikasi', 'Deal', 'Nilai deal', 'Per lead', 'Per lead kualitas', 'Per deal', 'ROAS'].map((label) => (
                    <th key={label} scope="col" className="px-3 py-2 text-right font-medium">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.rows.map((r) => (
                  <tr key={r.adId}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <CreativeThumb row={r} />
                        <span className="flex min-w-0 flex-col">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="max-w-64 truncate font-medium text-zinc-950" title={r.adName}>{r.adName}</span>
                            {winning.has(r.adId) && <WinningBadge />}
                          </span>
                          <span className="max-w-64 truncate text-xs text-zinc-500">{[r.campaignName, r.brand].filter(Boolean).join(' · ')}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(r.spend)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(r.impressions)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.ctr === null ? '—' : `${r.ctr.toLocaleString('id-ID')}%`}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(r.conversations)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(r.leads)}</td>
                    <td className={cn('px-3 py-2.5 text-right tabular-nums', r.spamRate >= 30 && 'font-semibold text-rose-600')}>{num(r.spam)}{r.spam > 0 && <span className="ml-1 text-xs text-zinc-500">{r.spamRate}%</span>}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(r.qualified)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(r.deals)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{rupiah(r.dealValue)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(r.costPerLead)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(r.costPerQualified)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(r.costPerDeal)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{roasText(r.roas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="text-xs text-zinc-500">
        Biaya, impresi, CTR, dan percakapan dari Meta (diperbarui tiap 15 menit). Lead, spam, dan deal dari chat yang masuk lewat iklan
        tersebut. Nilai deal = harga paket atau harga custom yang disepakati. Winning = sudah deal dan ROAS di atas rata-rata semua iklan.
      </p>
    </div>
  );
}
