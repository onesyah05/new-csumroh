import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { MessageCircle, Search, Users } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Pager } from '../../components/ui/pager';
import { EmptyState, PageError, PageLoading } from '../../components/ui/page-feedback';
import { rupiah, wibDateTime } from '../finance/verificationApi';
import { CreativeThumb } from './CreativesView';

type AdLead = {
  id: number; brandId: number; brand: string; name: string; phone: string | null;
  status: string; statusLabel: string; spam: boolean; dealValue: number; createdAt: string;
  pic: { id: number; name: string } | null;
};
type AdLeadsPageData = {
  ad: { adId: string; adName: string; campaignName: string | null; thumbnailUrl: string | null };
  summary: { leads: number; spam: number };
  items: AdLead[];
  total: number;
  page: number;
  pageSize: number;
};

const SPAM_OPTIONS = [
  { value: 'exclude', label: 'Lead (tanpa spam)' },
  { value: 'only', label: 'Spam saja' },
  { value: 'all', label: 'Semua' },
];

const dateText = (value: string | null) => (value ? new Date(`${value}T00:00:00+07:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/**
 * Prospek dari satu iklan Click-to-WhatsApp, dibuka dari angka Lead di Laporan › Kreatif iklan. Periode & brand
 * mengikuti Laporan (query string), jadi jumlahnya sama dengan angka di tabel. Pencarian & halaman di server.
 */
export function AdLeadsPage() {
  const { adId = '' } = useParams();
  const [params] = useSearchParams();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const brandId = params.get('brandId') ?? 'all';
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [spam, setSpam] = useState('exclude');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(1), [q, spam]);

  const leads = useQuery({
    queryKey: ['ad-leads', adId, from, to, brandId, q, spam, page],
    queryFn: () => {
      const query = new URLSearchParams({ from, to, brandId, search: q, spam, page: String(page), pageSize: '25' });
      return api.get<AdLeadsPageData>(`/reports/creatives/${adId}/prospects?${query}`);
    },
    enabled: Boolean(adId && from && to),
    placeholderData: keepPreviousData,
  });

  if (!from || !to) return <PageError title="Periode tidak diketahui" description="Buka halaman ini dari Laporan › Kreatif iklan." />;
  if (leads.isLoading) return <PageLoading label="Memuat prospek dari iklan…" />;
  if (leads.isError) return <PageError description={leads.error.message} onRetry={() => void leads.refetch()} />;
  const data = leads.data!;

  return (
    <div className="app-page space-y-5 pb-16">
      <PageHeader
        backUrl={`/laporan?tab=creatives`}
        kicker="Prospek dari iklan"
        title={<span className="flex min-w-0 items-center gap-3"><CreativeThumb row={data.ad} size="sm" /><span className="truncate" title={data.ad.adName}>{data.ad.adName}</span></span>}
        subtitle={[data.ad.campaignName, `${dateText(from)} – ${dateText(to)}`, `${data.summary.leads} lead · ${data.summary.spam} spam`].filter(Boolean).join(' · ')}
      />

      <div className="flex flex-wrap items-end gap-2">
        <label className="relative min-w-0 flex-1 basis-56">
          <span className="sr-only">Cari prospek</span>
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama atau nomor WhatsApp" className="field pl-9" />
        </label>
        <Select aria-label="Tampilkan" value={spam} onValueChange={setSpam} options={SPAM_OPTIONS} className="w-44" />
      </div>

      {!data.items.length ? (
        <EmptyState icon={Users} title="Tidak ada prospek" description={q ? 'Tidak ada prospek yang cocok dengan pencarian.' : 'Belum ada prospek dari iklan ini pada periode dan filter ini.'} />
      ) : (
        <section className={cn('overflow-hidden rounded-xl border border-zinc-200 bg-white', leads.isFetching && 'opacity-70')} aria-label="Prospek dari iklan">
          <ul className="divide-y divide-zinc-100">
            {data.items.map((p) => (
              <li key={p.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                <div className="min-w-0">
                  <Link to={`/prospects/${p.id}`} className="block truncate text-sm font-semibold text-zinc-950 hover:underline">{p.name}</Link>
                  <p className="truncate whitespace-nowrap font-mono text-xs text-zinc-500">{p.phone ? `+${p.phone}` : '—'}{brandId === 'all' ? ` · ${p.brand}` : ''}</p>
                </div>
                <div className="min-w-0 text-xs">
                  <span className={cn('rounded px-1.5 py-0.5 font-semibold', p.spam ? 'bg-rose-50 text-rose-700' : 'bg-zinc-100 text-zinc-700')}>{p.spam ? 'Spam' : p.statusLabel}</span>
                  {p.dealValue > 0 && <span className="ml-1.5 whitespace-nowrap font-semibold tabular-nums text-zinc-950">{rupiah(p.dealValue)}</span>}
                </div>
                <div className="min-w-0 text-xs text-zinc-500">
                  <p className="truncate whitespace-nowrap">PIC: <span className="text-zinc-800">{p.pic?.name ?? 'Belum ada'}</span></p>
                  <p className="whitespace-nowrap">Masuk {wibDateTime(p.createdAt)}</p>
                </div>
                <Link
                  to={`/inbox?prospectId=${p.id}&brandId=${p.brandId}`}
                  className="inline-flex items-center gap-1.5 justify-self-start whitespace-nowrap rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 sm:justify-self-end"
                >
                  <MessageCircle size={13} aria-hidden="true" />Buka chat
                </Link>
              </li>
            ))}
          </ul>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} label="prospek" />
        </section>
      )}
    </div>
  );
}
