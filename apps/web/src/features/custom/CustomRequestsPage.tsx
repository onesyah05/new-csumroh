import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, MessageCircle, Search, Undo2 } from 'lucide-react';
import {
  CUSTOM_DEFAULT_VALIDITY_DAYS, customStatusLabel, customDisplayStatus, customHoursLeft, customMinDpTotal, customRoomTotal, customRoomsFor,
  paxSummary, type CustomRoomPrices,
} from '@csumroh/shared-types';
import { RoomPriceTable } from './RoomPriceTable';
import { CustomSpecGroups } from './CustomSpecGroups';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { useAuth } from '../../app/auth';
import { showFeedback } from '../../app/toast';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { EmptyState, PageError, PageLoading } from '../../components/ui/page-feedback';
import { cn } from '../../lib/cn';
import { MoneyInput } from './MoneyInput';
import { onRovingKey, rovingTabIndex } from './roving';
import { ConfirmDialog } from '../../components/ui/modal';
import { dateRange, minDpTotal, money, packageServices, sinceLabel, timeLeftLabel, validUntilLabel, type CustomRequest } from './customApi';

const GROUPS = [
  { id: 'pending', label: 'Perlu dihitung' },
  { id: 'returned', label: 'Dikembalikan' },
  { id: 'quoted', label: 'Sudah dihitung' },
  { id: 'agreed', label: 'Disepakati' },
  { id: 'all', label: 'Semua' },
] as const;
type Group = typeof GROUPS[number]['id'];
type ListResponse = { rows: CustomRequest[]; counts: Record<string, number> };

const dateKey = (offsetDays: number) => new Date(Date.now() + 7 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const dayLabel = (value: string) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value));

/** Tahap prospek setelah harga disepakati: yang sudah Deal siap dipesan ke vendor. */
function dealStage(row: CustomRequest) {
  const p = row.prospect;
  if (!p) return null;
  if (p.status === 'deal' || p.status === 'closed_won') return 'Deal';
  if (p.invoiceSentAt) return 'Menunggu pembayaran';
  if (p.offerSentAt) return 'Penawaran terkirim';
  return 'Belum ada penawaran';
}

/** Keterangan waktu yang relevan per status (bukan sekadar "terakhir diubah"). */
function timeNote(row: CustomRequest) {
  const status = customDisplayStatus(row);
  if (status === 'submitted' || status === 'revision_requested') return { text: `menunggu ${sinceLabel(row.queuedAt ?? row.createdAt)}`, tone: 'text-zinc-500' };
  if (status === 'needs_info') return { text: 'menunggu CS', tone: 'text-amber-800' };
  if (status === 'quoted') {
    const hours = customHoursLeft(row.quoteValidUntil);
    return { text: hours !== null ? `berakhir ${timeLeftLabel(hours)}` : 'dihitung', tone: hours !== null && hours < 24 ? 'text-amber-800' : 'text-zinc-500' };
  }
  if (status === 'expired') return { text: 'kedaluwarsa', tone: 'text-amber-800' };
  if (status === 'agreed') {
    const stage = dealStage(row);
    return { text: [stage, row.agreedAt && `disepakati ${dayLabel(row.agreedAt)}`].filter(Boolean).join(' · '), tone: stage === 'Deal' ? 'font-semibold text-emerald-800' : 'text-emerald-800' };
  }
  return { text: '', tone: 'text-zinc-500' };
}

/**
 * Antrean Layanan Custom. Tim LA (semua brand) menghitung harga atau mengembalikan permintaan ke CS; CS dan Admin
 * melihat status permintaan brand-nya.
 */
export function CustomRequestsPage() {
  const { user } = useAuth();
  const canPrice = user?.role === 'product' || user?.role === 'superadmin';
  const [params, setParams] = useSearchParams();
  const [group, setGroup] = useState<Group>(canPrice ? 'pending' : 'all');
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState('all');
  const selectedId = Number(params.get('id')) || null;
  const list = useQuery({
    queryKey: ['custom-requests', group],
    queryFn: () => api.get<ListResponse>(`/custom-requests?group=${group}`),
    refetchInterval: 60_000,
  });
  const detail = useQuery({
    queryKey: ['custom-requests', 'detail', selectedId],
    queryFn: () => api.get<CustomRequest>(`/custom-requests/${selectedId}`),
    enabled: Boolean(selectedId),
  });
  const open = (id: number | null) => setParams(id ? { id: String(id) } : {});
  const counts = list.data?.counts ?? {};
  const countFor = (id: Group) => id === 'pending' ? (counts.submitted ?? 0) + (counts.revision_requested ?? 0)
    : id === 'returned' ? counts.needs_info : id === 'all' ? undefined : counts[id];
  const brands = useMemo(() => [...new Map((list.data?.rows ?? []).filter((row) => row.brand).map((row) => [row.brand!.id, row.brand!.name])).entries()], [list.data]);
  const rows = (list.data?.rows ?? []).filter((row) => {
    if (brand !== 'all' && String(row.brandId) !== brand) return false;
    const term = search.trim().toLowerCase();
    return !term || `${row.prospect?.name ?? ''} ${row.prospect?.user?.name ?? ''} ${row.basePackage?.name ?? ''}`.toLowerCase().includes(term);
  });

  return <div className="app-page">
    <PageHeader title="Layanan custom" subtitle={canPrice ? 'Hitung harga kebutuhan khusus jamaah dari semua brand, atau kembalikan ke CS bila datanya kurang.' : 'Status permintaan layanan custom jamaah Anda.'} />
    <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <section aria-label="Daftar permintaan" className={cn('surface overflow-hidden', selectedId && 'hidden lg:block')}>
        <div role="tablist" aria-label="Status permintaan" className="flex flex-wrap gap-1 border-b border-zinc-200 p-2" onKeyDown={(e) => onRovingKey(e, GROUPS.map((g) => g.id), group, setGroup)}>
          {GROUPS.map((item) => <button key={item.id} id={`custom-tab-${item.id}`} type="button" role="tab" aria-selected={group === item.id} aria-controls="custom-queue"
            tabIndex={group === item.id ? 0 : -1} onClick={() => setGroup(item.id)}
            className={cn('shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold', group === item.id ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100')}>
            {item.label}{countFor(item.id) ? <span className="ml-1 tabular-nums opacity-80">{countFor(item.id)}</span> : null}
          </button>)}
        </div>
        <div className="flex gap-2 border-b border-zinc-200 p-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Cari permintaan</span>
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input className="field pl-8" placeholder="Cari jamaah, CS, atau paket…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          {brands.length > 1 && <Select aria-label="Filter brand" className="w-36" value={brand} onValueChange={setBrand}
            options={[{ value: 'all', label: 'Semua brand' }, ...brands.map(([id, name]) => ({ value: String(id), label: name }))]} />}
        </div>
        <div id="custom-queue" role="tabpanel" aria-labelledby={`custom-tab-${group}`}>
        {list.isLoading ? <PageLoading label="Memuat permintaan" /> : list.isError ? <PageError description={list.error.message} onRetry={() => void list.refetch()} />
          : !rows.length ? <div className="p-6"><EmptyState title="Tidak ada permintaan" description={search || brand !== 'all' ? 'Tidak ada yang cocok dengan pencarian.' : group === 'pending' ? 'Semua permintaan sudah dihitung.' : 'Belum ada permintaan pada status ini.'} /></div>
          : <ul className="divide-y divide-zinc-100">
            {rows.map((row) => {
              const status = customDisplayStatus(row);
              const time = timeNote(row);
              const departure = dateRange(row.departureDate, row.departureDateTo);
              return <li key={row.id}>
                <button type="button" onClick={() => open(row.id)} aria-current={row.id === selectedId || undefined}
                  className={cn('w-full px-4 py-3 text-left hover:bg-zinc-50', row.id === selectedId && 'bg-zinc-50')}>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-zinc-950">{row.prospect?.name ?? `Prospek #${row.prospectId}`}</span>
                    <span className={cn('shrink-0 text-xs tabular-nums', time.tone)}>{time.text}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-zinc-700">
                    {row.mode === 'package' ? 'Berbasis paket' : 'Full custom'}{departure ? ` · berangkat ${departure}` : ''} · {paxSummary(row)}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-zinc-500">
                    {row.brand?.name} · CS {row.prospect?.user?.name ?? '–'}{row.budgetPerPax ? ` · budget ${money(row.budgetPerPax)}/org` : ''}
                    {row.claimedBy && (status === 'submitted' || status === 'revision_requested') ? ` · dihitung ${row.claimedBy.id === user?.id ? 'Anda' : row.claimedBy.name}` : ''}
                  </span>
                  {group === 'all' && <span className={cn('mt-0.5 block text-xs font-medium', status === 'agreed' ? 'text-emerald-800' : status === 'expired' || status === 'needs_info' ? 'text-amber-800' : 'text-zinc-700')}>{customStatusLabel(status, canPrice ? 'la' : 'cs')}</span>}
                </button>
              </li>;
            })}
          </ul>}
        </div>
      </section>

      <section aria-label="Detail permintaan" className={cn('surface min-h-[20rem] p-5', !selectedId && 'hidden lg:block')}>
        {!selectedId ? <EmptyState title="Pilih permintaan" description="Rincian kebutuhan jamaah dan form harga tampil di sini." />
          : detail.isLoading ? <PageLoading label="Memuat rincian" />
          : detail.isError || !detail.data ? <PageError description={detail.error?.message} onRetry={() => void detail.refetch()} />
          : <RequestDetail key={`${detail.data.id}:${detail.data.updatedAt}`} request={detail.data} canPrice={canPrice} userId={user?.id} onBack={() => open(null)} />}
      </section>
    </div>
  </div>;
}

function RequestDetail({ request, canPrice, userId, onBack }: { request: CustomRequest; canPrice: boolean; userId?: number; onBack(): void }) {
  const status = customDisplayStatus(request);
  const editable = canPrice && ['submitted', 'revision_requested', 'quoted'].includes(request.status) && status !== 'agreed';
  const canReturn = canPrice && ['submitted', 'revision_requested'].includes(request.status);
  // Kebutuhan diubah CS setelah masuk antrean (Tim LA mungkin sudah mulai menghitung).
  const editedByCs = (status === 'submitted' || status === 'revision_requested') && Boolean(request.queuedAt)
    && new Date(request.updatedAt).getTime() - new Date(request.queuedAt!).getTime() > 5_000;
  const [returning, setReturning] = useState(false);
  const [returnNote, setReturnNote] = useState('');
  const [pkgOpen, setPkgOpen] = useState(false);
  const back = useMutation({
    mutationFn: () => api.post<CustomRequest>(`/custom-requests/${request.id}/return`, { note: returnNote.trim() }),
    onSuccess: () => {
      showFeedback('Permintaan dikembalikan ke CS.');
      setReturning(false);
      void queryClient.invalidateQueries({ queryKey: ['custom-requests'] });
    },
  });
  const claimable = canPrice && ['submitted', 'revision_requested', 'quoted'].includes(request.status) && status !== 'agreed';
  const claimedByMe = Boolean(request.claimedById && request.claimedById === userId);
  const claimedByOther = Boolean(request.claimedById && request.claimedById !== userId);
  const claim = useMutation({
    mutationFn: (path: 'claim' | 'release') => api.post<CustomRequest>(`/custom-requests/${request.id}/${path}`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['custom-requests'] }),
  });
  const pkg = request.basePackage;
  const pkgRows = pkg ? ([
    ['Sudah termasuk', packageServices(pkg).join('\n')],
    ['Belum termasuk', packageServices({ facilitiesIncluded: pkg.facilitiesExcluded }).join('\n')],
    ['Itinerary', packageServices({ facilitiesIncluded: pkg.itinerary }).join('\n')],
  ] as const).filter(([, value]) => value) : [];

  return <div className="space-y-5">
    <div className="flex items-start gap-3">
      <Button size="icon" variant="ghost" className="lg:hidden" aria-label="Kembali ke daftar" onClick={onBack}><ArrowLeft size={16} /></Button>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-bold text-zinc-950">{request.prospect?.name}</h2>
        <p className="mt-0.5 text-xs text-zinc-600">{request.brand?.name} · CS {request.prospect?.user?.name ?? '–'} · dikirim {request.createdBy?.name ?? '–'}</p>
        <p className={cn('mt-1 text-xs font-semibold', status === 'expired' || status === 'needs_info' ? 'text-amber-800' : status === 'agreed' ? 'text-emerald-800' : 'text-zinc-900')}>
          {customStatusLabel(status, canPrice ? 'la' : 'cs')}{(status === 'submitted' || status === 'revision_requested') ? ` · menunggu ${sinceLabel(request.queuedAt ?? request.createdAt)}` : ''}{status === 'agreed' && dealStage(request) ? ` · ${dealStage(request)}` : ''}
        </p>
      </div>
      {!canPrice && <Link to={`/inbox?prospectId=${request.prospectId}&brandId=${request.brandId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-900 hover:underline"><MessageCircle size={13} />Buka chat</Link>}
      {canReturn && <Button size="sm" variant="secondary" icon={<Undo2 size={14} />} onClick={() => setReturning(true)}>Kembalikan ke CS</Button>}
    </div>
    {claimable && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs">
      <span className="text-zinc-700">{request.claimedBy
        ? <>Sedang dihitung <b className="font-semibold text-zinc-900">{claimedByMe ? 'Anda' : request.claimedBy.name}</b>{request.claimedAt ? ` · sejak ${sinceLabel(request.claimedAt)} lalu` : ''}</>
        : 'Belum ada yang menghitung permintaan ini.'}</span>
      {claimedByMe
        ? <Button size="sm" variant="ghost" loading={claim.isPending} onClick={() => claim.mutate('release')}>Lepas</Button>
        : <Button size="sm" variant={claimedByOther ? 'secondary' : 'primary'} loading={claim.isPending} onClick={() => claim.mutate('claim')}>{claimedByOther ? 'Ambil alih' : 'Ambil untuk dihitung'}</Button>}
      {claim.error && <p role="alert" className="w-full text-rose-700">{claim.error.message}</p>}
    </div>}
    {editedByCs && <p role="status" className="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-800"><b className="font-semibold">Diubah CS {sinceLabel(request.updatedAt)} lalu.</b> Rincian di bawah sudah versi terbaru.</p>}
    {request.status === 'revision_requested' && request.revisionNote && <p className="whitespace-pre-line rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Hitung ulang: {request.revisionNote}</p>}
    {request.status === 'needs_info' && request.returnNote && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Dikembalikan ke CS: {request.returnNote}</p>}

    <CustomSpecGroups request={request} />

    {pkgRows.length > 0 && <div className="border-t border-zinc-100 pt-3">
      <button type="button" aria-expanded={pkgOpen} onClick={() => setPkgOpen(!pkgOpen)} className="flex w-full items-center justify-between py-1 text-left text-xs font-semibold text-zinc-900">
        {pkgOpen ? 'Sembunyikan isi paket dasar' : `Lihat isi paket dasar: ${pkg!.name}`}
        <ChevronDown size={14} aria-hidden="true" className={cn('text-zinc-500 transition-transform', pkgOpen && 'rotate-180')} />
      </button>
      {pkgOpen && <dl className="grid gap-4 pt-2 text-xs md:grid-cols-3">
        {pkgRows.map(([label, value]) => <div key={label}><dt className="mb-1 font-semibold text-zinc-700">{label}</dt><dd className="whitespace-pre-line text-zinc-800">{value}</dd></div>)}
      </dl>}
    </div>}

    {editable ? <QuoteForm request={request} claimedByOther={claimedByOther ? request.claimedBy?.name ?? 'anggota Tim LA lain' : null} />
      : request.offeredPrice ? <div className="space-y-1.5 rounded-lg bg-zinc-50 p-3 text-xs">
        <RoomPriceTable request={request} />
        <p className="flex justify-between"><span className="text-zinc-600">DP minimal</span><span className="tabular-nums">{money(minDpTotal(request))}</span></p>
        {request.quoteValidUntil && <p className="flex justify-between"><span className="text-zinc-600">Berlaku sampai</span><span className="tabular-nums">{validUntilLabel(request.quoteValidUntil)}</span></p>}
        {request.agreedPrice && <p className="flex justify-between border-t border-zinc-200 pt-1"><span className="text-zinc-600">Disepakati CS</span><b className="tabular-nums text-emerald-800">{money(request.agreedPrice)}</b></p>}
        {request.quotedBy && <p className="text-zinc-500">Dihitung {request.quotedBy.name}{request.quoteCount > 1 ? ` · diperbarui ${request.quoteCount - 1}×` : ''}</p>}
      </div> : request.status !== 'needs_info' && <p className="text-xs text-zinc-500">Belum dihitung Tim LA.</p>}

    <Modal open={returning} onClose={() => setReturning(false)} size="sm" title="Kembalikan ke CS"
      description="CS mendapat notifikasi, melengkapi kebutuhan, lalu permintaan masuk antrean lagi."
      footer={<>
        <Button variant="secondary" onClick={() => setReturning(false)}>Batal</Button>
        <Button disabled={returnNote.trim().length < 5} loading={back.isPending} onClick={() => back.mutate()}>Kembalikan</Button>
      </>}>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-700">Apa yang perlu dilengkapi atau diganti?</span>
        <textarea rows={3} maxLength={2000} value={returnNote} onChange={(e) => setReturnNote(e.target.value)} className="field h-auto resize-none py-2"
          placeholder="Mis. hotel Madinah penuh di tanggal itu, pilih alternatif; jumlah malam Makkah belum diisi" />
      </label>
      {back.error && <p role="alert" className="mt-2 text-xs text-rose-700">{back.error.message}</p>}
    </Modal>
  </div>;
}

function QuoteForm({ request, claimedByOther }: { request: CustomRequest; claimedByOther: string | null }) {
  const [confirmForce, setConfirmForce] = useState(false);
  const rooms = customRoomsFor(request);
  const [offered, setOffered] = useState<CustomRoomPrices>(request.offeredPrices ?? {});
  const [floor, setFloor] = useState<CustomRoomPrices>(request.floorPrices ?? {});
  const [dp, setDp] = useState<number | null>(request.minDpPerPax ? Number(request.minDpPerPax) : null);
  const [dpInfant, setDpInfant] = useState<number | null>(request.minDpInfant !== null && request.minDpInfant !== undefined ? Number(request.minDpInfant) : null);
  const hasInfant = request.paxInfant > 0;
  const [validity, setValidity] = useState<'default' | 'date'>('default');
  const [validUntil, setValidUntil] = useState(dateKey(CUSTOM_DEFAULT_VALIDITY_DAYS));
  const [note, setNote] = useState(request.quoteNote ?? '');
  const pax = request.paxQuad + request.paxTriple + request.paxDouble + request.paxInfant;
  const offeredTotal = customRoomTotal(offered, request);
  const floorTotal = customRoomTotal(floor, request);
  const invalidRooms = rooms.filter((room) => offered[room.key] && floor[room.key] && floor[room.key]! > offered[room.key]!);
  const save = useMutation({
    mutationFn: (force: boolean) => api.post<CustomRequest>(`/custom-requests/${request.id}/quote`, {
      version: request.updatedAt, force, offeredPrices: offered, floorPrices: floor, minDpPerPax: dp, minDpInfant: hasInfant ? dpInfant : null, validUntil: validity === 'date' ? validUntil : null, note: note.trim() || null,
    }),
    onSuccess: () => {
      setConfirmForce(false);
      showFeedback('Harga terkirim ke CS.');
      void queryClient.invalidateQueries({ queryKey: ['custom-requests'] });
    },
  });
  const ready = offeredTotal !== null && floorTotal !== null && Boolean(dp) && (!hasInfant || dpInfant !== null) && invalidRooms.length === 0 && (validity === 'default' || validUntil >= dateKey(0));
  const setPrice = (setter: typeof setOffered, key: keyof CustomRoomPrices) => (value: number | null) =>
    setter((prev) => ({ ...prev, [key]: value ?? undefined }));

  return <div className="space-y-3 border-t border-zinc-200 pt-4">
    <div>
      <h3 className="text-sm font-semibold text-zinc-950">{request.status === 'quoted' ? 'Perbarui harga' : 'Hitung harga'}</h3>
      <p className="text-xs text-zinc-500">Isi harga per jamaah untuk setiap tipe kamar. Total dihitung otomatis. Rincian modal tidak disimpan di CRM.</p>
    </div>
    {/* Satu baris per tipe kamar; di layar sempit kolom harga bertumpuk (tanpa gulir horizontal). */}
    <div className="space-y-2 text-xs">
      <div className="hidden grid-cols-[9rem_1fr_1fr] gap-2 font-medium text-zinc-600 sm:grid">
        <span>Kamar</span><span>Harga ditawarkan / jamaah</span><span>Harga terendah / jamaah</span>
      </div>
      {rooms.map((room) => <div key={room.key} className="grid gap-2 rounded-lg border border-zinc-100 p-2 sm:grid-cols-[9rem_1fr_1fr] sm:items-center sm:border-0 sm:p-0">
        <span className="font-medium text-zinc-900">{room.label} <span className="font-normal text-zinc-500">× {room.pax}</span></span>
        <div><span className="mb-1 block text-zinc-500 sm:hidden">Ditawarkan / jamaah</span><MoneyInput aria-label={`Harga ditawarkan ${room.label} per jamaah`} value={offered[room.key] ?? null} onChange={setPrice(setOffered, room.key)} /></div>
        <div><span className="mb-1 block text-zinc-500 sm:hidden">Terendah / jamaah</span><MoneyInput aria-label={`Harga terendah ${room.label} per jamaah`} value={floor[room.key] ?? null} onChange={setPrice(setFloor, room.key)} invalid={invalidRooms.includes(room)} /></div>
      </div>)}
      <div className="grid grid-cols-2 gap-2 border-t border-zinc-200 pt-2 font-semibold text-zinc-950 sm:grid-cols-[9rem_1fr_1fr]">
        <span className="col-span-2 sm:col-span-1">Total <span className="font-normal text-zinc-500">({pax} jamaah)</span></span>
        <span className="tabular-nums"><span className="font-normal text-zinc-500 sm:hidden">Ditawarkan </span>{offeredTotal !== null ? money(offeredTotal) : '–'}</span>
        <span className="tabular-nums"><span className="font-normal text-zinc-500 sm:hidden">Terendah </span>{floorTotal !== null ? money(floorTotal) : '–'}</span>
      </div>
    </div>
    {invalidRooms.length > 0 && <p className="text-xs font-semibold text-rose-700">Harga terendah {invalidRooms.map((room) => room.label).join(', ')} tidak boleh di atas harga ditawarkan.</p>}
    <div className={cn('grid gap-3 sm:items-end', hasInfant ? 'sm:grid-cols-[14rem_14rem_1fr]' : 'sm:grid-cols-[14rem_1fr]')}>
      <label className="block"><span className="mb-1 block text-xs font-medium text-zinc-700">DP minimal per dewasa</span><MoneyInput aria-label="DP minimal per dewasa" value={dp} onChange={setDp} /></label>
      {hasInfant && <label className="block"><span className="mb-1 block text-xs font-medium text-zinc-700">DP minimal per bayi</span><MoneyInput aria-label="DP minimal per bayi" value={dpInfant} onChange={setDpInfant} placeholder="Boleh 0" /></label>}
      <p className="pb-2 text-xs text-zinc-500">{dp && (!hasInfant || dpInfant !== null)
        ? `DP minimal total ${money(customMinDpTotal({ ...request, minDpPerPax: dp, minDpInfant: dpInfant }))} untuk ${pax} jamaah.`
        : hasInfant ? 'Isi DP bayi (boleh 0).' : 'Berlaku untuk setiap jamaah dewasa.'}</p>
    </div>
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className="font-medium text-zinc-700">Berlaku</span>
      <div role="radiogroup" aria-label="Masa berlaku harga" className="inline-flex rounded-lg border border-zinc-200 p-0.5" onKeyDown={(e) => onRovingKey(e, ['default', 'date'] as const, validity, setValidity)}>
        {([['default', `${CUSTOM_DEFAULT_VALIDITY_DAYS} hari`], ['date', 'Sampai tanggal']] as const).map(([value, label]) =>
          <button key={value} type="button" role="radio" aria-checked={validity === value} tabIndex={rovingTabIndex(value, validity, 'default')} onClick={() => setValidity(value)}
            className={cn('rounded-md px-3 py-1.5 font-semibold', validity === value ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100')}>{label}</button>)}
      </div>
      {validity === 'date' && <input type="date" aria-label="Berlaku sampai tanggal" min={dateKey(0)} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="field w-auto" />}
    </div>
    <label className="block"><span className="mb-1 block text-xs font-medium text-zinc-700">Catatan untuk CS (opsional)</span>
      <textarea rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className="field h-auto resize-none py-2" placeholder="Mis. hotel Madinah diganti setara karena penuh" />
    </label>
    {save.error && <p role="alert" className="text-xs text-rose-700">{save.error.message}{(save.error as { status?: number }).status === 409 && <>
      {' '}<button type="button" className="font-semibold underline" onClick={() => void queryClient.invalidateQueries({ queryKey: ['custom-requests'] })}>Muat ulang rincian</button></>}</p>}
    <div className="flex justify-end">
      <Button disabled={!ready} loading={save.isPending} onClick={() => (claimedByOther ? setConfirmForce(true) : save.mutate(false))}>{request.status === 'quoted' ? 'Perbarui harga' : 'Kirim harga ke CS'}</Button>
    </div>
    <ConfirmDialog open={confirmForce} onClose={() => setConfirmForce(false)} onConfirm={() => save.mutate(true)} tone="primary"
      title="Tetap kirim harga?" description={`Permintaan ini sedang dihitung ${claimedByOther}. Harga Anda akan menggantikan hitungannya.`}
      confirmLabel="Kirim harga" pending={save.isPending} />
  </div>;
}
