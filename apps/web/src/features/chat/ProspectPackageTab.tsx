import { useId, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronDown, FileText, ImageIcon, Plane, Search, X } from 'lucide-react';
import {
  adultPaxOf, businessDateKey, dateOnlyKey, formatCatalogRupiah, isPackageDeparted, packageBookingValue, packageFit,
  packageFromPrice, paxSummary, type MatchablePackage,
} from '@csumroh/shared-types';
import { resolveMediaUrl } from '../../lib/api';
import { cn } from '../../lib/cn';

type Pkg = MatchablePackage & Record<string, any>;
type Qualification = {
  targetMonth?: string | null; budgetRange?: string | null; passportStatus?: string | null;
  paxQuad: number; paxTriple: number; paxDouble: number; paxInfant: number;
};

const DAY = 86_400_000;
const money = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', notation: 'compact', maximumFractionDigits: 1 }).format(value);
const moneyFull = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
const dateLabel = (value?: string | Date | null) =>
  value ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value)) : null;
const daysLeft = (value?: string | Date | null) =>
  value ? Math.ceil((new Date(value).getTime() - 7 * 3_600_000 - Date.now()) / DAY) : null;

function departureText(pkg: Pkg) {
  const date = dateLabel(pkg.departureDate) ?? pkg.departureInfo ?? 'Jadwal belum ada';
  const days = daysLeft(pkg.departureDate);
  return days === null ? date : days < 0 ? `${date} · sudah berangkat` : days === 0 ? `${date} · hari ini` : `${date} · ${days} hari lagi`;
}

const lines = (text?: string | null) => String(text ?? '').split('\n').map((line) => line.replace(/^[-•*\s]+/, '').trim()).filter(Boolean);
const DETAIL_KEY = 'csumroh_package_detail_open';
const readOpen = () => { try { return localStorage.getItem(DETAIL_KEY) === '1'; } catch { return false; } };
const saveOpen = (open: boolean) => { try { localStorage.setItem(DETAIL_KEY, open ? '1' : '0'); } catch { /* opsional */ } };

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-1">
    <h4 className="text-xs font-semibold text-zinc-900">{title}</h4>
    {children}
  </section>;
}
function Row({ label, value }: { label: string; value?: ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return <div className="flex items-baseline justify-between gap-3"><dt className="shrink-0 text-zinc-600">{label}</dt><dd className="min-w-0 text-right font-medium text-zinc-900">{value}</dd></div>;
}
function Bullets({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-zinc-500">{empty}</p>;
  return <ul className="space-y-0.5">{items.map((item, i) => <li key={i} className="flex gap-1.5 text-zinc-800"><span aria-hidden="true" className="text-zinc-400">•</span><span className="min-w-0">{item}</span></li>)}</ul>;
}

/**
 * Rincian lengkap paket dari katalog untuk ditinjau CS sebelum menjawab jamaah (harga per kamar, DP, fasilitas,
 * pengecualian, promo, itinerary). Hanya-baca; data yang kosong di katalog ditulis "belum diisi", tidak ditebak.
 */
function PackageDetails({ pkg }: { pkg: Pkg }) {
  const rooms = ([['Quad', pkg.priceQuad || pkg.price], ['Triple', pkg.priceTriple], ['Double', pkg.priceDouble], ['Bayi', pkg.priceInfant]] as const)
    .map(([label, price]) => ({ label, price: formatCatalogRupiah(price) }))
    .filter((row) => row.price);
  const promoDeadline = dateOnlyKey(pkg.promoDeadline);
  const promoActive = Boolean(pkg.isPromo && pkg.promoDiscount && (!promoDeadline || promoDeadline >= businessDateKey()));
  const included = lines(pkg.facilitiesIncluded);
  const excluded = lines(pkg.facilitiesExcluded);
  const highlights = lines(pkg.highlights);
  const itinerary = lines(pkg.itinerary);
  return <div className="space-y-3 text-xs">
    <DetailSection title="Perjalanan">
      <dl className="space-y-0.5">
        <Row label="Berangkat" value={dateLabel(pkg.departureDate) ?? pkg.departureInfo ?? 'Belum diisi'} />
        {/* Keterangan jadwal hanya bila menambah informasi (bukan tanggal yang sama ditulis ulang, mis. "05 Des 2026"). */}
        {pkg.departureDate && pkg.departureInfo && pkg.departureInfo.trim().replace(/^0/, '').toLowerCase() !== dateLabel(pkg.departureDate)?.toLowerCase()
          && <Row label="Keterangan" value={pkg.departureInfo} />}
        <Row label="Durasi" value={pkg.duration || 'Belum diisi'} />
        <Row label="Maskapai" value={pkg.airline ? `${pkg.airline}${pkg.flightType === 'direct' ? ' · Direct' : pkg.flightType === 'transit' ? ' · Transit' : ''}` : 'Belum diisi'} />
        <Row label="Hotel Makkah" value={pkg.hotelMakkah || 'Belum diisi'} />
        <Row label="Hotel Madinah" value={pkg.hotelMadinah || 'Belum diisi'} />
        <Row label="Sisa kuota" value={pkg.quotaRemaining != null ? `${pkg.quotaRemaining} orang` : 'Belum diisi'} />
      </dl>
    </DetailSection>
    <DetailSection title="Harga per orang">
      <dl className="space-y-0.5">
        {rooms.length ? rooms.map((row) => <Row key={row.label} label={row.label} value={<span className="tabular-nums">{row.price}</span>} />) : <p className="text-zinc-500">Belum diisi</p>}
        <Row label="DP" value={<span className="tabular-nums">{formatCatalogRupiah(pkg.dp) ?? 'Belum diisi'}</span>} />
      </dl>
      {pkg.isPromo && pkg.promoDiscount && <p className={cn('mt-1', promoActive ? 'text-emerald-800' : 'text-zinc-500')}>
        Promo {pkg.promoDiscount}{promoDeadline ? ` · ${promoActive ? 'sampai' : 'berakhir'} ${dateLabel(pkg.promoDeadline)}` : ''}
      </p>}
    </DetailSection>
    <DetailSection title="Sudah termasuk"><Bullets items={included} empty="Belum diisi" /></DetailSection>
    <DetailSection title="Belum termasuk"><Bullets items={excluded} empty="Belum diisi. Pastikan ke admin sebelum menyebut total biaya." /></DetailSection>
    {highlights.length > 0 && <DetailSection title="Keunggulan"><Bullets items={highlights} empty="" /></DetailSection>}
    {itinerary.length > 0 && <DetailSection title="Itinerary"><Bullets items={itinerary} empty="" /></DetailSection>}
  </div>;
}

/**
 * Tab Paket di profil Inbox: paket terpilih (langsung tersimpan), kecocokan dengan kualifikasi, estimasi untuk
 * jamaah ini, dan bahan jualan. Aksi utama (penawaran) ada di "Langkah berikutnya", bukan di tab ini.
 */
export function ProspectPackageTab({
  packages, selected, qualification, locked, saving, connected,
  onSelect, onSendFlyer, onInsertSummary, onInsertItinerary, onOpenGallery, onOpenQualification, onPreviewImage, footer,
}: {
  packages: Pkg[];
  selected: Pkg | null;
  /** Isian kualifikasi saat ini (termasuk draft) untuk kecocokan dan estimasi. */
  qualification: Qualification;
  /** Deal: paket terkunci. */
  locked: boolean;
  saving: boolean;
  connected: boolean;
  onSelect(packageId: number): void;
  onSendFlyer(pkg: Pkg): void;
  onInsertSummary(): void;
  onInsertItinerary(): void;
  onOpenGallery(): void;
  onOpenQualification(): void;
  onPreviewImage?(url: string): void;
  /** Aksi tahap (penawaran, invoice, bukti) diletakkan setelah paket dan harga yang menjadi dasarnya. */
  footer?: ReactNode;
}) {
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState('');
  const [detailOpen, setDetailOpen] = useState(readOpen);
  const detailId = useId();

  // Pilihan: paket aktif yang belum berangkat; yang cocok dengan kualifikasi di atas, lalu tanggal terdekat.
  const choices = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return packages
      .filter((pkg) => pkg.isActive !== false && !isPackageDeparted(pkg))
      .map((pkg) => {
        const fit = packageFit(pkg, qualification);
        const flags = [fit.month, fit.budget, fit.quota];
        const score = flags.filter((v) => v === true).length - flags.filter((v) => v === false).length * 2;
        return { pkg, fit, score, text: `${pkg.name} ${pkg.airline ?? ''} ${dateLabel(pkg.departureDate) ?? pkg.departureInfo ?? ''}`.toLowerCase() };
      })
      .filter((row) => words.every((w) => row.text.includes(w)))
      .sort((a, b) => b.score - a.score || String(a.pkg.departureDate ?? '9').localeCompare(String(b.pkg.departureDate ?? '9')));
  }, [packages, qualification, search]);

  function close() {
    setPicking(false);
    setSearch('');
  }
  function choose(pkg: Pkg) {
    close();
    if (pkg.id !== selected?.id) onSelect(pkg.id);
  }

  if (picking) {
    return (
      <section aria-label="Pilih paket" className="-mx-4 -my-3">
        {/* Kolom cari memakai gaya field standar, sama dengan pencarian Copilot. */}
        <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2.5">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Cari paket</span>
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama paket…"
              aria-label="Cari paket"
              className="field w-full pl-9"
            />
          </label>
          <button type="button" onClick={close} aria-label="Tutup pilihan paket" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900">
            <X size={16} />
          </button>
        </div>
        <ul className="divide-y divide-zinc-100">
          {choices.length === 0 && <li className="px-4 py-3 text-xs text-zinc-600">Tidak ada paket yang cocok dengan pencarian.</li>}
          {choices.map(({ pkg, fit: rowFit }) => {
            const from = packageFromPrice(pkg);
            const current = pkg.id === selected?.id;
            const matches = rowFit.month === true && rowFit.budget !== false && rowFit.quota !== false;
            return (
              <li key={pkg.id}>
                <button type="button" onClick={() => choose(pkg)} className={cn('w-full px-4 py-2 text-left hover:bg-zinc-50', current && 'bg-zinc-50')}>
                  <span className="flex items-start gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-900" title={pkg.name}>{pkg.name}</span>
                    {current && <span className="shrink-0 text-xs text-zinc-600">Terpilih</span>}
                    {!current && matches && <span className="shrink-0 text-xs font-semibold text-emerald-800">Cocok</span>}
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-600">
                    {dateLabel(pkg.departureDate) ?? pkg.departureInfo ?? 'Jadwal belum ada'}
                    {from ? ` · ${money(from)}` : ''}
                    {pkg.quotaRemaining != null ? ` · sisa ${pkg.quotaRemaining}` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-zinc-200 px-4 py-2">
          <button type="button" onClick={() => { close(); onOpenGallery(); }} className="text-xs font-semibold text-zinc-800 underline">Galeri brosur</button>
        </div>
      </section>
    );
  }

  if (!selected) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 text-xs text-zinc-600">
          <span>Belum ada paket.</span>
          {!locked && (
            <button type="button" disabled={saving} onClick={() => setPicking(true)} className="rounded-md border border-zinc-300 px-3 py-1.5 font-semibold text-zinc-900 hover:border-zinc-500">
              Pilih paket
            </button>
          )}
        </div>
        {footer}
      </div>
    );
  }

  const adults = adultPaxOf(qualification);
  const estimate = adults > 0 ? packageBookingValue(selected, qualification) : 0;
  const fit = packageFit(selected, qualification);
  const departed = isPackageDeparted(selected);
  const problems = [
    fit.month === false && 'Beda bulan target',
    fit.budget === false && 'Di atas budget',
    fit.quota === false && `Kuota kurang (sisa ${selected.quotaRemaining})`,
    departed && 'Sudah berangkat',
    selected.isActive === false && 'Nonaktif',
  ].filter(Boolean) as string[];
  const from = packageFromPrice(selected);

  // Bahan yang belum ada di katalog tidak ditampilkan (CS tidak bisa memperbaikinya dari sini).
  const actions = [
    ...(selected.flyerImage ? [{ label: 'Flyer', icon: ImageIcon, disabled: !connected, onClick: () => onSendFlyer(selected) }] : []),
    { label: 'Harga', icon: FileText, disabled: false, onClick: onInsertSummary },
    ...(selected.itinerary ? [{ label: 'Itinerary', icon: Plane, disabled: false, onClick: onInsertItinerary }] : []),
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        {selected.flyerImage && onPreviewImage ? (
          <button
            type="button"
            onClick={() => onPreviewImage(resolveMediaUrl(selected.flyerImage))}
            aria-label={`Lihat flyer ${selected.name}`}
            className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-zinc-100"
          >
            <img src={resolveMediaUrl(selected.flyerImage)} alt="" className="h-full w-full object-cover" />
          </button>
        ) : (
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-zinc-100 text-zinc-500" aria-hidden="true">
            <ImageIcon size={18} />
          </span>
        )}
        <div className="min-w-0 flex-1 text-xs">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 truncate font-semibold text-zinc-950" title={selected.name}>{selected.name}</h3>
            {locked ? (
              <span className="shrink-0 text-zinc-500">Terkunci</span>
            ) : (
              <button type="button" disabled={saving} onClick={() => setPicking(true)} className="shrink-0 font-semibold text-zinc-900 hover:underline">
                {saving ? 'Menyimpan...' : 'Ganti'}
              </button>
            )}
          </div>
          <p className="mt-0.5 text-zinc-600">{departureText(selected)}</p>
          <p className="text-zinc-600">
            {from ? <><b className="font-semibold text-zinc-900">{money(from)}</b>/orang</> : 'Harga belum ada'}
            {selected.quotaRemaining != null && ` · sisa ${selected.quotaRemaining}`}
          </p>
        </div>
      </div>

      <dl className="space-y-1 border-t border-zinc-100 pt-3 text-xs">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-zinc-600">Kecocokan</dt>
          <dd className={cn('inline-flex items-center gap-1 font-semibold', problems.length ? 'text-amber-800' : fit.month ? 'text-emerald-800' : 'text-zinc-500')}>
            {problems.length ? <AlertTriangle size={12} aria-hidden="true" /> : fit.month ? <Check size={12} aria-hidden="true" /> : null}
            {problems.length ? problems.join(' · ') : fit.month ? 'Cocok' : 'Isi kualifikasi'}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-zinc-600">{adults > 0 ? `Estimasi · ${paxSummary(qualification)}` : 'Estimasi'}</dt>
          <dd>
            {adults > 0 ? (
              <b className="font-semibold tabular-nums text-zinc-950" title={moneyFull(estimate)}>{money(estimate)}</b>
            ) : (
              <button type="button" onClick={onOpenQualification} className="font-semibold text-zinc-900 underline">Isi jumlah jamaah</button>
            )}
          </dd>
        </div>
      </dl>

      {/* Rincian katalog untuk ditinjau CS; status buka/tutup diingat di perangkat ini. */}
      <div className="border-t border-zinc-100 pt-2">
        <button type="button" aria-expanded={detailOpen} aria-controls={detailId}
          onClick={() => { setDetailOpen(!detailOpen); saveOpen(!detailOpen); }}
          className="flex w-full items-center justify-between gap-2 py-1 text-left text-xs font-semibold text-zinc-900">
          {detailOpen ? 'Sembunyikan detail paket' : 'Lihat detail paket'}
          <ChevronDown size={14} aria-hidden="true" className={cn('text-zinc-500 transition-transform', detailOpen && 'rotate-180')} />
        </button>
        {detailOpen && <div id={detailId} className="pt-2"><PackageDetails pkg={selected} /></div>}
      </div>

      {/* Bahan jualan ke chat: flyer dikirim lewat pratinjau, harga & itinerary disisipkan ke kolom pesan. */}
      <div className="flex items-center gap-1.5 border-t border-zinc-100 pt-3">
        <span className="mr-0.5 text-xs text-zinc-600">Ke chat:</span>
        {actions.map(({ label, icon: Icon, disabled, onClick }) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            onClick={onClick}
            aria-label={`${label === 'Flyer' ? 'Kirim flyer' : `Sisipkan ${label.toLowerCase()}`} ke chat`}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-800 hover:border-zinc-400 disabled:text-zinc-400"
          >
            <Icon size={12} aria-hidden="true" />{label}
          </button>
        ))}
      </div>
      {footer}
    </div>
  );
}
