import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { businessDateKey } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { rupiah } from '../finance/verificationApi';
import { CreativeThumb, WinningBadge, roasText, winningAdIds, type CreativesReport } from '../reports/CreativesView';

/**
 * Iklan teratas periode Ringkasan (Admin/Superadmin): biaya iklan tidak ditampilkan ke CS.
 * `to` dari Ringkasan bersifat eksklusif, jadi dikurangi 1 ms sebelum menjadi tanggal WIB.
 */
export function TopAds({ from, to, brandScope }: { from: string; to: string; brandScope: string }) {
  const range = { from: businessDateKey(new Date(from)), to: businessDateKey(new Date(Math.min(new Date(to).getTime() - 1, Date.now()))) };
  const query = useQuery({
    queryKey: ['report', 'creatives', `from=${range.from}&to=${range.to}&brandId=${brandScope}`],
    queryFn: () => api.get<CreativesReport>(`/reports/creatives?from=${range.from}&to=${range.to}&brandId=${brandScope}`),
    staleTime: 5 * 60_000,
  });
  const rows = (query.data?.rows ?? []).filter((r) => r.spend || r.leads).slice(0, 5);
  if (!rows.length) return null;
  const winning = winningAdIds(query.data?.rows ?? []);

  return (
    <section className="surface overflow-hidden" aria-label="Iklan teratas">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-zinc-950">Iklan teratas</h2>
          <p className="mt-0.5 text-xs text-zinc-600">Menurut nilai deal, lalu biaya</p>
        </div>
        <Link to="/laporan?tab=creatives" className="shrink-0 text-xs font-medium text-zinc-700 hover:text-zinc-950 hover:underline">Semua iklan</Link>
      </div>
      <ul className="divide-y divide-zinc-100">
        {rows.map((r) => (
          <li key={r.adId} className="flex items-center gap-3 px-5 py-3">
            <CreativeThumb row={r} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-zinc-900" title={r.adName}>{r.adName}</span>
                {winning.has(r.adId) && <WinningBadge />}
              </p>
              <p className="truncate text-xs text-zinc-600">
                {r.spend !== null ? `${rupiah(r.spend)} · ` : ''}{r.leads} lead · {r.deals} deal{r.spam ? ` · ${r.spam} spam` : ''}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-bold tabular-nums text-zinc-950">{roasText(r.roas)}</p>
              <p className="text-xs text-zinc-500">ROAS</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
