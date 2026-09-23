import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  CalendarDays,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Hotel,
  ImageIcon,
  Luggage,
  Plane,
  Sparkles,
  UsersRound,
  X,
  XCircle,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { resolveMediaUrl } from '../../lib/api';

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
  brand?: { id: number; name: string; code: string; phone?: string | null };
}

interface PackageDetailModalProps {
  pkg: PackageItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (pkg: PackageItem) => void;
  canManage?: boolean;
}

export function PackageDetailModal({ pkg, open, onOpenChange, onEdit, canManage }: PackageDetailModalProps) {
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [copiedItin, setCopiedItin] = useState(false);
  const [copyTab, setCopyTab] = useState<'summary' | 'itinerary'>('summary');

  if (!pkg) return null;

  const departureStr = pkg.departureInfo || (pkg.departureDate ? new Date(pkg.departureDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Jadwal menyusul');
  const durationStr = pkg.duration || '9 Hari';
  const airlineStr = pkg.airline ? `${pkg.airline} (${pkg.flightType === 'transit' ? 'Transit' : 'Direct'})` : 'TBA';
  const quadPrice = pkg.priceQuad || pkg.price || '-';

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

  // 1. WA Format: Ringkasan Paket
  let waSummary = `*${pkg.name.toUpperCase()}*\n`;
  waSummary += `Travel: ${pkg.brand?.name || 'Layanan Resmi'}\n\n`;
  waSummary += `📅 Keberangkatan: ${departureStr} (${durationStr})\n`;
  waSummary += `✈️ Maskapai: ${airlineStr}\n`;
  if (pkg.hotelMakkah) waSummary += `🏨 Hotel Makkah: ${pkg.hotelMakkah}\n`;
  if (pkg.hotelMadinah) waSummary += `🏨 Hotel Madinah: ${pkg.hotelMadinah}\n`;
  waSummary += `\n💰 *HARGA PAKET:*\n`;
  waSummary += `• Quad (Kamar Ber-4): ${quadPrice}\n`;
  if (pkg.priceTriple) waSummary += `• Triple (Kamar Ber-3): ${pkg.priceTriple}\n`;
  if (pkg.priceDouble) waSummary += `• Double (Kamar Ber-2): ${pkg.priceDouble}\n`;
  if (pkg.priceInfant) waSummary += `• Infant (< 2 Thn): ${pkg.priceInfant}\n`;
  waSummary += `• Minimal DP: ${pkg.dp}\n`;

  if (incItems.length > 0) {
    waSummary += `\n✅ *FASILITAS INCLUDE:*\n`;
    incItems.forEach((item) => {
      waSummary += `• ${item}\n`;
    });
  }

  if (pkg.isPromo) {
    waSummary += `\n🎁 *PROMO KHUSUS:* Potongan ${pkg.promoDiscount || 'Spesial'}${pkg.promoDeadline ? ` (s.d. ${new Date(pkg.promoDeadline).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })})` : ''}\n`;
  }
  waSummary += `\n🎟️ Sisa Kuota: ${pkg.quotaRemaining ?? '-'} Seat\n`;
  waSummary += `Info pendaftaran & konsultasi silakan balas pesan ini. Terima kasih! 🙏`;

  // 2. WA Format: Itinerary Rundown
  let waItinerary = `*${pkg.name.toUpperCase()}*\n`;
  waItinerary += `*Rundown Agenda Perjalanan*\n`;
  waItinerary += `Travel: ${pkg.brand?.name || 'Layanan Resmi'}\n\n`;
  waItinerary += `📅 Keberangkatan: ${departureStr} (${durationStr})\n`;
  waItinerary += `✈️ Penerbangan: ${airlineStr}\n\n`;
  waItinerary += `🕋 *AGENDA HARIAN:*\n`;
  if (itinLines.length > 0) {
    itinLines.forEach((line) => {
      waItinerary += `• ${line}\n`;
    });
  } else {
    waItinerary += `_Rincian agenda harian ziarah sedang disiapkan oleh tim operasional._\n`;
  }
  waItinerary += `\n_Catatan: Jadwal dan ziarah dapat disesuaikan dengan kondisi operasional di lapangan demi kenyamanan & kelancaran jamaah._\n\n`;
  waItinerary += `Ada agenda atau kegiatan yang ingin ditanyakan lebih detail, Kak? Kami siap membantu! 🙏`;

  const copyToClipboard = async (text: string, type: 'summary' | 'itin') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'summary') {
        setCopiedSummary(true);
        setTimeout(() => setCopiedSummary(false), 2000);
      } else {
        setCopiedItin(true);
        setTimeout(() => setCopiedItin(false), 2000);
      }
    } catch {
      // Fallback
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-4xl -translate-x-1/2 -translate-y-1/2 max-h-[92vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl border border-zinc-200 focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 sm:p-7">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-zinc-100 pb-5">
            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-zinc-900 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-white">
                  {pkg.brand?.name || 'Paket Umroh'}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    pkg.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-zinc-100 text-zinc-500'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${pkg.isActive ? 'bg-emerald-600' : 'bg-zinc-400'}`} />
                  {pkg.isActive ? 'Aktif' : 'Arsip'}
                </span>
                {pkg.isPromo && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-800 border border-amber-200">
                    <Sparkles size={12} className="text-amber-600" />
                    Promo: {pkg.promoDiscount || 'Diskon Spesial'}
                  </span>
                )}
              </div>
              <Dialog.Title className="font-display text-xl sm:text-2xl font-extrabold tracking-tight text-zinc-900">
                {pkg.name}
              </Dialog.Title>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <CalendarDays size={14} className="text-zinc-400" />
                  Keberangkatan: <strong className="text-zinc-800">{departureStr}</strong> ({durationStr})
                </span>
                <span className="text-zinc-300">•</span>
                <span>
                  Sisa Kuota:{' '}
                  <strong className={pkg.quotaRemaining && pkg.quotaRemaining <= 5 ? 'text-rose-600 font-extrabold' : 'text-zinc-800'}>
                    {pkg.quotaRemaining ?? 0} Seat
                  </strong>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {canManage && onEdit && (
                <Button variant="secondary" onClick={() => onEdit(pkg)} className="text-xs">
                  Edit Paket
                </Button>
              )}
              <Dialog.Close asChild>
                <button
                  aria-label="Tutup"
                  className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition"
                >
                  <X size={18} />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {/* Body Content: 2-Column Grid */}
          <div className="mt-6 grid gap-6 lg:grid-cols-12 items-start">
            {/* Left Column (Main Specs) - 8 cols */}
            <div className="space-y-6 lg:col-span-8">
              {/* 1. Room Pricing Grid */}
              <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/50 p-4 sm:p-5">
                <h4 className="flex items-center gap-2 font-display text-xs font-extrabold uppercase tracking-wider text-zinc-500">
                  <UsersRound size={15} />
                  Skema Harga Kamar & Uang Muka (DP)
                </h4>
                <div className="mt-3.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-2xs">
                    <span className="block text-[11px] font-semibold text-zinc-500">Quad (Kamar ber-4)</span>
                    <span className="mt-1 block font-display text-sm font-extrabold text-zinc-900">{quadPrice}</span>
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-2xs">
                    <span className="block text-[11px] font-semibold text-zinc-500">Triple (Kamar ber-3)</span>
                    <span className="mt-1 block font-display text-sm font-extrabold text-zinc-900">{pkg.priceTriple || '-'}</span>
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-2xs">
                    <span className="block text-[11px] font-semibold text-zinc-500">Double (Kamar ber-2)</span>
                    <span className="mt-1 block font-display text-sm font-extrabold text-zinc-900">{pkg.priceDouble || '-'}</span>
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-2xs">
                    <span className="block text-[11px] font-semibold text-zinc-500">Infant (&lt; 2 Thn)</span>
                    <span className="mt-1 block font-display text-sm font-extrabold text-zinc-900">{pkg.priceInfant || '-'}</span>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between rounded-xl bg-zinc-100 px-3.5 py-2.5 text-xs">
                  <span className="font-semibold text-zinc-600">Minimal Transfer DP:</span>
                  <span className="font-display font-extrabold text-zinc-900">{pkg.dp}</span>
                </div>
              </div>

              {/* 2. Flight & Accommodation */}
              <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-2xs space-y-3">
                <h4 className="flex items-center gap-2 font-display text-xs font-extrabold uppercase tracking-wider text-zinc-500">
                  <Plane size={15} />
                  Penerbangan & Hotel
                </h4>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 block">Maskapai</span>
                    <span className="mt-0.5 block font-bold text-zinc-900 text-sm">{pkg.airline || 'TBA'}</span>
                    <span className="mt-1 inline-block text-[10px] font-semibold rounded bg-zinc-200 px-1.5 py-0.5 text-zinc-700">
                      {pkg.flightType === 'transit' ? 'Transit' : 'Direct'}
                    </span>
                  </div>
                  <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 block">Hotel Makkah</span>
                    <span className="mt-0.5 block font-bold text-zinc-900 text-sm">{pkg.hotelMakkah || 'TBA'}</span>
                    <span className="mt-1 flex items-center gap-1 text-[10px] text-amber-600 font-semibold">
                      <Hotel size={11} /> Makkah Al-Mukarramah
                    </span>
                  </div>
                  <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 block">Hotel Madinah</span>
                    <span className="mt-0.5 block font-bold text-zinc-900 text-sm">{pkg.hotelMadinah || 'TBA'}</span>
                    <span className="mt-1 flex items-center gap-1 text-[10px] text-amber-600 font-semibold">
                      <Hotel size={11} /> Madinah Al-Munawwarah
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. Facilities: Include & Exclude */}
              <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-2xs">
                <h4 className="flex items-center gap-2 font-display text-xs font-extrabold uppercase tracking-wider text-zinc-500 mb-3">
                  <Luggage size={15} />
                  Fasilitas Paket
                </h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3.5 space-y-2">
                    <span className="flex items-center gap-1.5 font-bold text-xs text-emerald-900">
                      <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                      Termasuk (Include)
                    </span>
                    {incItems.length > 0 ? (
                      <ul className="space-y-1 text-xs text-zinc-700">
                        {incItems.map((item, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-emerald-600 font-bold">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-zinc-400 italic">Rincian include belum dicantumkan.</p>
                    )}
                  </div>
                  <div className="rounded-xl border border-rose-100 bg-rose-50/30 p-3.5 space-y-2">
                    <span className="flex items-center gap-1.5 font-bold text-xs text-rose-900">
                      <XCircle size={14} className="text-rose-500 shrink-0" />
                      Tidak Termasuk (Exclude)
                    </span>
                    {excItems.length > 0 ? (
                      <ul className="space-y-1 text-xs text-zinc-600">
                        {excItems.map((item, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-rose-400 font-bold">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-zinc-400 italic">Rincian exclude belum dicantumkan.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* 4. Itinerary Rundown */}
              <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="flex items-center gap-2 font-display text-xs font-extrabold uppercase tracking-wider text-zinc-500">
                    <CalendarDays size={15} />
                    Itinerary Perjalanan
                  </h4>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(waItinerary, 'itin')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-bold text-zinc-700 hover:bg-zinc-100 transition"
                  >
                    {copiedItin ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                    {copiedItin ? 'Tersalin!' : 'Salin Rundown'}
                  </button>
                </div>
                {itinLines.length > 0 ? (
                  <div className="space-y-2">
                    {itinLines.map((line, idx) => (
                      <div key={idx} className="flex items-start gap-3 rounded-xl bg-zinc-50/80 p-2.5 text-xs text-zinc-800">
                        <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-zinc-950 text-[9px] font-bold text-white">
                          {idx + 1}
                        </span>
                        <p className="leading-relaxed">{line}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-400 italic">Belum ada rincian rundown perjalanan.</p>
                )}
              </div>
            </div>

            {/* Right Column (Sidebar: Flyer + Quick WhatsApp Tools) - 4 cols */}
            <div className="space-y-5 lg:col-span-4">
              {/* Flyer Poster Preview */}
              <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-100">
                  <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                    <ImageIcon size={14} />
                    Flyer Poster
                  </h4>
                  {pkg.flyerImage && (
                    <a
                      href={resolveMediaUrl(pkg.flyerImage)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] font-bold text-zinc-600 hover:text-black flex items-center gap-1"
                    >
                      Buka Penuh <ExternalLink size={12} />
                    </a>
                  )}
                </div>
                {pkg.flyerImage ? (
                  <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 aspect-3/4">
                    <img
                      src={resolveMediaUrl(pkg.flyerImage)}
                      alt={`Flyer ${pkg.name}`}
                      className="h-full w-full object-cover transition hover:scale-105"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  </div>
                ) : (
                  <div className="grid aspect-3/4 place-items-center rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50 text-center p-4">
                    <div className="space-y-1">
                      <ImageIcon size={28} className="mx-auto text-zinc-300" />
                      <p className="text-xs font-semibold text-zinc-500">Belum ada gambar flyer</p>
                      <p className="text-[10px] text-zinc-400">Dapat ditambahkan melalui menu Edit Paket</p>
                    </div>
                  </div>
                )}
              </div>

              {/* 1-Click WhatsApp Quick Quote Station */}
              <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-100">
                  <div className="flex items-center gap-1 rounded-lg bg-zinc-100 p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setCopyTab('summary')}
                      className={`rounded-md px-2.5 py-1 font-bold transition ${
                        copyTab === 'summary' ? 'bg-white text-black shadow-2xs' : 'text-zinc-500 hover:text-black'
                      }`}
                    >
                      Ringkasan WA
                    </button>
                    <button
                      type="button"
                      onClick={() => setCopyTab('itinerary')}
                      className={`rounded-md px-2.5 py-1 font-bold transition ${
                        copyTab === 'itinerary' ? 'bg-white text-black shadow-2xs' : 'text-zinc-500 hover:text-black'
                      }`}
                    >
                      Itinerary WA
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => copyToClipboard(copyTab === 'summary' ? waSummary : waItinerary, copyTab === 'summary' ? 'summary' : 'itin')}
                    className="flex items-center gap-1 text-xs font-bold text-black hover:underline"
                  >
                    {(copyTab === 'summary' ? copiedSummary : copiedItin) ? (
                      <span className="text-emerald-600 flex items-center gap-1">
                        <Check size={13} /> Tersalin!
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Copy size={13} /> Salin Teks
                      </span>
                    )}
                  </button>
                </div>

                <textarea
                  readOnly
                  rows={8}
                  value={copyTab === 'summary' ? waSummary : waItinerary}
                  className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-700 focus:outline-none select-all"
                />
                <p className="text-[10px] text-zinc-400">
                  {copyTab === 'summary'
                    ? 'Format penawaran resmi paket (harga kamar & fasilitas) siap kirim ke calon jamaah.'
                    : 'Format agenda harian untuk calon jamaah yang menanyakan detail rute ibadah.'}
                </p>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
