import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CheckCircle2,
  Copy,
  ImageIcon,
  MessageSquare,
  Pencil,
  ShieldCheck,
  Star,
  ToggleLeft,
  ToggleRight,
  Trash2,
  XCircle,
  ZoomIn,
} from 'lucide-react';
import { api, resolveMediaUrl } from '../../lib/api';
import { useAuth } from '../../app/auth';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { StatGrid, StatCard } from '../../components/ui/stat-card';
import { StatusBadge } from '../../components/ui/status-badge';
import { showFeedback } from '../../app/toast';
import { ConfirmDialog } from '../../components/ui/modal';
import { ImageLightbox } from '../../components/ui/image-lightbox';

export interface PackageItem {
  id: number;
  brandId: number;
  name: string;
  price: string;
  dp: string;
  priceQuad?: string | null;
  priceTriple?: string | null;
  priceDouble?: string | null;
  priceInfant?: string | null;
  quotaRemaining?: number | null;
  departureDate?: string | null;
  departureInfo?: string | null;
  airline?: string | null;
  flightType?: string | null;
  hotelMakkah?: string | null;
  hotelMadinah?: string | null;
  duration?: string | null;
  facilitiesIncluded?: string | null;
  facilitiesExcluded?: string | null;
  itinerary?: string | null;
  highlights?: string | null;
  flyerImage?: string | null;
  isPromo?: boolean;
  promoDiscount?: string | null;
  promoDeadline?: string | null;
  isActive: boolean;
  brand?: { id: number; name: string; code: string; phone?: string | null; ppiuNumber?: string | null };
}

function formatRupiah(value?: string | null): string {
  if (!value) return '-';
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '-') return '-';
  if (/^rp/i.test(trimmed)) return trimmed;
  return `Rp ${trimmed}`;
}

function parseHotel(name?: string | null) {
  if (!name || name.trim() === '' || name.trim() === '-') {
    return { name: 'TBA', stars: 0 };
  }
  const starMatch = name.match(/★\s*(\d+)/i) || name.match(/bintang\s*(\d+)/i) || name.match(/(\d+)\s*\*/);
  const stars = starMatch && starMatch[1] ? Math.min(5, Math.max(1, parseInt(starMatch[1], 10))) : 0;
  const cleanName = name
    .replace(/\(★\s*\d+\)/gi, '')
    .replace(/★\s*\d+/gi, '')
    .replace(/\(bintang\s*\d+\)/gi, '')
    .replace(/bintang\s*\d+/gi, '')
    .replace(/\(\s*\d+\*\s*\)/gi, '')
    .trim();
  return { name: cleanName || name, stars };
}

function HotelInfo({ label, rawName }: { label: string; rawName?: string | null }) {
  const { name, stars } = parseHotel(rawName);
  return (
    <div>
      <span className="text-zinc-500 block text-xs font-medium">{label}</span>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <span className="font-semibold text-zinc-900">{name}</span>
        {stars > 0 && (
          <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-bold text-amber-700 border border-amber-200/60">
            <Star size={10} className="fill-amber-400 text-amber-500 shrink-0" />
            <span>★{stars}</span>
          </span>
        )}
      </div>
    </div>
  );
}

export function PackageDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManage = user?.role === 'superadmin' || user?.role === 'admin';

  const [copyTab, setCopyTab] = useState<'summary' | 'itinerary'>('summary');
  const [copied, setCopied] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  function showToast(msg: string) {
    showFeedback(msg);
  }

  // Fetch package details
  const packageQuery = useQuery({
    queryKey: ['package', id],
    queryFn: () => api.get<PackageItem>(`/catalog/packages/${id}`),
    enabled: Boolean(id),
  });

  const pkg = packageQuery.data;

  // Toggle active mutation
  const toggleMutation = useMutation({
    mutationFn: () => api.patch<{ id: number; isActive: boolean }>(`/catalog/packages/${id}/toggle`, {}),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['package', id] });
      void queryClient.invalidateQueries({ queryKey: ['packages'] });
      const isNowActive = data?.isActive ?? !pkg?.isActive;
      showToast(`Paket berhasil ${isNowActive ? 'diaktifkan' : 'diarsipkan'}.`);
    },
    onError: (err: any) => showToast(err?.message || 'Gagal mengubah status paket.'),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/catalog/packages/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['packages'] });
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
      navigate('/packages', { replace: true });
    },
    onError: (err: any) => showToast(err?.message || 'Gagal menghapus paket.'),
  });

  if (packageQuery.isLoading) return <PageLoading label="Memuat rincian paket umroh…" />;
  if (packageQuery.isError || !pkg) {
    return (
      <PageError
        title="Paket tidak ditemukan"
        description={(packageQuery.error as Error)?.message || 'Data paket umroh tidak dapat dimuat atau telah dihapus.'}
        onRetry={() => void packageQuery.refetch()}
      />
    );
  }

  const departureStr =
    pkg.departureInfo ||
    (pkg.departureDate
      ? new Date(pkg.departureDate).toLocaleDateString('id-ID', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : 'Jadwal menyusul');
  const durationStr = pkg.duration || '9 Hari';
  const flightTypeLabel = pkg.flightType === 'transit' ? 'Transit' : 'Langsung (Direct)';
  const airlineStr = pkg.airline ? `${pkg.airline} (${flightTypeLabel})` : 'TBA';
  const quadPrice = formatRupiah(pkg.priceQuad || pkg.price);

  const incItems = (pkg.facilitiesIncluded || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const excItems = (pkg.facilitiesExcluded || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const itinLines = (pkg.itinerary || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  // Clean promo string
  const cleanPromo = pkg.promoDiscount ? pkg.promoDiscount.replace(/diskon\s*/gi, '').trim() : '';

  // WA format: Ringkasan siap kirim
  let waSummary = `*${pkg.name.toUpperCase()}*\n`;
  waSummary += `Travel: ${pkg.brand?.name || 'Layanan Resmi'}\n`;
  waSummary += `Keberangkatan: ${departureStr} (${durationStr})\n`;
  waSummary += `Maskapai: ${airlineStr}\n`;
  if (pkg.hotelMakkah) waSummary += `Hotel Makkah: ${pkg.hotelMakkah}\n`;
  if (pkg.hotelMadinah) waSummary += `Hotel Madinah: ${pkg.hotelMadinah}\n`;
  waSummary += `\n*HARGA PAKET:*\n`;
  waSummary += `• Quad (Ber-4): ${quadPrice}\n`;
  if (pkg.priceTriple) waSummary += `• Triple (Ber-3): ${formatRupiah(pkg.priceTriple)}\n`;
  if (pkg.priceDouble) waSummary += `• Double (Ber-2): ${formatRupiah(pkg.priceDouble)}\n`;
  if (pkg.priceInfant) waSummary += `• Infant (< 2 Thn): ${formatRupiah(pkg.priceInfant)}\n`;
  waSummary += `• Minimal DP: ${formatRupiah(pkg.dp)}\n`;
  if (incItems.length > 0) {
    waSummary += `\n*Fasilitas Termasuk:*\n${incItems.map((i) => `• ${i}`).join('\n')}\n`;
  }
  if (pkg.isPromo) {
    waSummary += `\n*Promo:* Potongan ${cleanPromo ? formatRupiah(cleanPromo) : 'Spesial'}\n`;
  }
  waSummary += `\nSisa Kuota: ${pkg.quotaRemaining ?? '-'} Seat`;

  // WA format: Itinerary siap kirim
  let waItinerary = `*ITINERARY ${pkg.name.toUpperCase()}*\n`;
  waItinerary += `Keberangkatan: ${departureStr} (${durationStr})\n`;
  waItinerary += `Penerbangan: ${airlineStr}\n\n`;
  if (itinLines.length > 0) {
    waItinerary += itinLines.join('\n');
  } else {
    waItinerary += 'Rincian agenda harian belum tersedia.';
  }

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(copyTab === 'summary' ? waSummary : waItinerary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showToast('Teks berhasil disalin.');
    } catch {
      showToast('Gagal menyalin teks.');
    }
  };

  return (
    <div className="app-page space-y-5 pb-16">
      {/* Header */}
      <PageHeader
        backUrl="/packages"
        title={pkg.name}
        badges={
          <>
            {pkg.brand && (
              <span className="rounded-md border border-zinc-200 bg-zinc-100 px-2 py-0.5 font-mono text-xs font-semibold text-zinc-700">
                {pkg.brand.code}
              </span>
            )}
            <StatusBadge
              status={pkg.isActive ? 'active' : 'archived'}
              label={pkg.isActive ? 'Aktif' : 'Arsip'}
              dot
            />
            {pkg.isPromo && (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                Promo {cleanPromo ? formatRupiah(cleanPromo) : ''}
              </span>
            )}
          </>
        }
        subtitle={`${pkg.brand?.name || 'Biro Resmi'} · Keberangkatan ${departureStr} (${durationStr})`}
        actions={
          canManage ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => toggleMutation.mutate()}
                disabled={toggleMutation.isPending}
                icon={
                  pkg.isActive ? (
                    <ToggleRight size={17} className="text-emerald-600" />
                  ) : (
                    <ToggleLeft size={17} className="text-zinc-500" />
                  )
                }
                title={pkg.isActive ? 'Arsipkan paket' : 'Aktifkan paket'}
              >
                {pkg.isActive ? 'Arsipkan' : 'Aktifkan'}
              </Button>

              <Button
                variant="primary"
                size="md"
                to={`/packages/${pkg.id}/edit`}
                icon={<Pencil size={13} />}
              >
                Edit Paket
              </Button>

              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setDeleteConfirmOpen(true)}
                className="text-zinc-500 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 cursor-pointer"
                title="Hapus paket"
              >
                <Trash2 size={14} />
              </Button>
            </>
          ) : undefined
        }
      />

      {/* 4 Metric Stats */}
      <StatGrid cols={4}>
        <StatCard
          label="Harga Mulai (Quad)"
          value={quadPrice}
          note="Kamar ber-4 (Quad)"
        />
        <StatCard
          label="Minimal DP"
          value={formatRupiah(pkg.dp)}
          note="Uang muka pendaftaran"
        />
        <StatCard
          label="Sisa Kuota"
          value={`${pkg.quotaRemaining ?? 0} Seat`}
          note={pkg.quotaRemaining && pkg.quotaRemaining <= 5 ? 'Seat hampir habis' : 'Seat tersedia'}
          alert={Boolean(pkg.quotaRemaining && pkg.quotaRemaining <= 5)}
        />
        <StatCard
          label="Penerbangan"
          value={pkg.airline || 'TBA'}
          note={pkg.flightType === 'transit' ? 'Transit Flight' : 'Direct Flight (Langsung)'}
        />
      </StatGrid>

      {/* Layout 2 Kolom SaaS */}
      <div className="grid gap-5 lg:grid-cols-12 items-start">
        {/* Kolom Utama (8 cols) */}
        <div className="space-y-5 lg:col-span-8">
          {/* Card 1: Spesifikasi & Skema Harga */}
          <Card className="p-5 space-y-5">
            <div>
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-700">
                Spesifikasi & Akomodasi
              </h3>
              <div className="mt-3.5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 text-xs">
                <div>
                  <span className="text-zinc-500 block text-xs font-medium">Maskapai</span>
                  <span className="font-semibold text-zinc-900 mt-0.5 block">{pkg.airline || 'TBA'}</span>
                  <span className="text-xs text-zinc-500 font-medium">{flightTypeLabel}</span>
                </div>
                <HotelInfo label="Hotel Makkah" rawName={pkg.hotelMakkah} />
                <HotelInfo label="Hotel Madinah" rawName={pkg.hotelMadinah} />
                <div>
                  <span className="text-zinc-500 block text-xs font-medium">Durasi Program</span>
                  <span className="font-semibold text-zinc-900 mt-0.5 block">{durationStr}</span>
                  <span className="text-xs text-zinc-500 font-medium">Hari Perjalanan</span>
                </div>
              </div>
            </div>

            <div className="border-t border-zinc-100 pt-4">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-700">
                Skema Harga Kamar
              </h3>
              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-xl bg-zinc-50/80 p-3.5 border border-zinc-200/80 shadow-xs">
                  <span className="text-xs font-bold text-zinc-500 block uppercase tracking-wider">Quad (Ber-4)</span>
                  <span className="mt-1 font-mono text-sm font-bold text-zinc-950 block">{quadPrice}</span>
                </div>
                <div className="rounded-xl bg-zinc-50/80 p-3.5 border border-zinc-200/80 shadow-xs">
                  <span className="text-xs font-bold text-zinc-500 block uppercase tracking-wider">Triple (Ber-3)</span>
                  <span className="mt-1 font-mono text-sm font-bold text-zinc-950 block">{formatRupiah(pkg.priceTriple)}</span>
                </div>
                <div className="rounded-xl bg-zinc-50/80 p-3.5 border border-zinc-200/80 shadow-xs">
                  <span className="text-xs font-bold text-zinc-500 block uppercase tracking-wider">Double (Ber-2)</span>
                  <span className="mt-1 font-mono text-sm font-bold text-zinc-950 block">{formatRupiah(pkg.priceDouble)}</span>
                </div>
                <div className="rounded-xl bg-zinc-50/80 p-3.5 border border-zinc-200/80 shadow-xs">
                  <span className="text-xs font-bold text-zinc-500 block uppercase tracking-wider">Infant (&lt; 2 Thn)</span>
                  <span className="mt-1 font-mono text-sm font-bold text-zinc-950 block">{formatRupiah(pkg.priceInfant)}</span>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs rounded-xl bg-zinc-100/80 px-4 py-2.5 border border-zinc-200/60">
                <span className="text-zinc-600 font-medium">Ketentuan Uang Muka (Minimal DP):</span>
                <span className="font-mono font-bold text-zinc-950 text-sm">{formatRupiah(pkg.dp)}</span>
              </div>
            </div>
          </Card>

          {/* Card 2: Fasilitas & Itinerary */}
          <Card className="p-5 space-y-5">
            <div>
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-700 mb-3">
                Fasilitas Paket
              </h3>
              <div className="grid gap-3.5 sm:grid-cols-2 text-xs">
                {/* Termasuk */}
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-4">
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                    <span className="font-bold text-emerald-900 text-xs uppercase tracking-wider">
                      Termasuk (Include)
                    </span>
                  </div>
                  {incItems.length > 0 ? (
                    <ul className="space-y-1.5 text-zinc-700">
                      {incItems.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                          <Check size={12} className="text-emerald-600 mt-0.5 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-zinc-500 italic text-xs">Belum ada rincian fasilitas termasuk.</p>
                  )}
                </div>

                {/* Tidak Termasuk */}
                <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4">
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <XCircle size={13} className="text-zinc-500 shrink-0" />
                    <span className="font-bold text-zinc-600 text-xs uppercase tracking-wider">
                      Tidak Termasuk (Exclude)
                    </span>
                  </div>
                  {excItems.length > 0 ? (
                    <ul className="space-y-1.5 text-zinc-600">
                      {excItems.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                          <span className="text-zinc-500 mt-0.5 shrink-0 font-bold">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-zinc-500 italic text-xs">Belum ada rincian fasilitas tidak termasuk.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-zinc-100 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-700">
                  Itinerary Perjalanan
                </h3>
                {itinLines.length > 0 && (
                  <span className="text-xs font-semibold text-zinc-500">
                    Total {itinLines.length} Hari Agenda
                  </span>
                )}
              </div>
              {itinLines.length > 0 ? (
                <div className="space-y-2">
                  {itinLines.map((line, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-3 rounded-lg border border-zinc-100 bg-zinc-50/60 p-3 hover:bg-zinc-50 hover:border-zinc-200 transition-colors"
                    >
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-xs font-bold text-white shadow-xs">
                        {idx + 1}
                      </span>
                      <p className="text-[13px] leading-relaxed text-zinc-800">{line}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-500 italic">Belum ada data agenda perjalanan.</p>
              )}
            </div>
          </Card>
        </div>

        {/* Kolom Sidebar (4 cols) */}
        <div className="space-y-5 lg:col-span-4">
          {/* Card 1: Poster Flyer */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-100">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-700">
                Poster Flyer
              </h3>
              {pkg.flyerImage && (
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  className="text-xs font-semibold text-zinc-600 hover:text-zinc-950 flex items-center gap-1 transition cursor-pointer"
                >
                  <ZoomIn size={12} />
                  <span>Perbesar</span>
                </button>
              )}
            </div>

            {pkg.flyerImage ? (
              <div
                role="button"
                tabIndex={0}
                onClick={() => setLightboxOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setLightboxOpen(true);
                }}
                className="group relative cursor-pointer overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 aspect-3/4 shadow-xs"
              >
                <img
                  src={resolveMediaUrl(pkg.flyerImage)}
                  alt={`Flyer ${pkg.name}`}
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-black/0 transition duration-300 group-hover:bg-black/35 flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-xs">
                    <ZoomIn size={13} />
                    <span>Lihat Penuh</span>
                  </span>
                </div>
              </div>
            ) : (
              <div className="grid aspect-3/4 place-items-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50 text-center p-4">
                <div className="space-y-1 text-zinc-500">
                  <ImageIcon size={28} className="mx-auto opacity-30" />
                  <p className="text-xs font-semibold text-zinc-600">Belum ada poster flyer</p>
                </div>
              </div>
            )}
          </Card>

          {/* Card 2: Template WhatsApp */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-100">
              <div className="flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
                <button
                  type="button"
                  onClick={() => setCopyTab('summary')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                    copyTab === 'summary' ? 'bg-white text-zinc-950 font-bold shadow-xs' : 'text-zinc-500 hover:text-zinc-950'
                  }`}
                >
                  Ringkasan
                </button>
                <button
                  type="button"
                  onClick={() => setCopyTab('itinerary')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                    copyTab === 'itinerary' ? 'bg-white text-zinc-950 font-bold shadow-xs' : 'text-zinc-500 hover:text-zinc-950'
                  }`}
                >
                  Itinerary
                </button>
              </div>

              <button
                type="button"
                onClick={copyToClipboard}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-bold text-zinc-800 hover:bg-zinc-50 hover:text-zinc-950 transition cursor-pointer shadow-xs"
              >
                {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                <span>{copied ? 'Tersalin' : 'Salin Teks'}</span>
              </button>
            </div>

            <div className="relative rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 max-h-72 overflow-y-auto">
              <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-zinc-800 select-all font-normal">
                {copyTab === 'summary' ? waSummary : waItinerary}
              </pre>
            </div>
          </Card>

          {/* Card 3: Biro Penyelenggara */}
          {pkg.brand && (
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-100">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-700">
                  Biro Penyelenggara
                </h3>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
                  <ShieldCheck size={12} className="text-emerald-600" />
                  <span>Terverifikasi</span>
                </span>
              </div>
              <div className="text-xs space-y-2">
                <div>
                  <p className="font-bold text-zinc-900 text-sm">{pkg.brand.name}</p>
                  <span className="text-zinc-500 font-mono text-xs">Kode: {pkg.brand.code}</span>
                </div>
                {pkg.brand.ppiuNumber && (
                  <div className="rounded-lg bg-zinc-50 p-2 border border-zinc-100">
                    <span className="text-xs text-zinc-500 block font-medium">Izin Resmi PPIU</span>
                    <p className="font-mono text-xs font-bold text-zinc-800 mt-0.5">{pkg.brand.ppiuNumber}</p>
                  </div>
                )}
                {pkg.brand.phone && (() => {
                  const rawDigits = pkg.brand.phone.replace(/\D/g, '');
                  const waNumber = rawDigits.startsWith('0') ? `62${rawDigits.slice(1)}` : rawDigits;
                  return (
                    <a
                      href={`https://wa.me/${waNumber}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3 py-2 text-xs font-bold text-white shadow-xs transition w-full mt-2"
                    >
                      <MessageSquare size={13} />
                      <span>Chat WhatsApp ({pkg.brand.phone})</span>
                    </a>
                  );
                })()}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Lightbox Flyer Modal */}
      {pkg.flyerImage && (
        <ImageLightbox
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          src={resolveMediaUrl(pkg.flyerImage)}
          alt={`Flyer ${pkg.name}`}
        />
      )}

      <ConfirmDialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        pending={deleteMutation.isPending}
        title="Hapus paket?"
        description={<>Paket <strong>{pkg.name}</strong> akan dihapus. Tindakan ini tidak dapat dibatalkan.</>}
        confirmLabel="Hapus paket"
      />

    </div>
  );
}
