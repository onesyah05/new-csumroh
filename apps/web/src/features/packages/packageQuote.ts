import { businessDateKey, dateOnlyKey, formatCatalogRupiah, formatRupiah, packageFromPrice } from '@csumroh/shared-types';
import { waBullets, waDate, waLine, waMessage, waTitle } from '../chat/waFormat';

/**
 * Ringkasan paket untuk WhatsApp (audit C10, C11). Nominal hanya dari parser rupiah ketat (tidak ada "Rp Rp" atau
 * tebakan), promo hanya bila masih berlaku, kuota hanya bila masih ada; tanpa janji "penguncian seat".
 */
const departure = (pkg: any) => [waDate(pkg.departureDate) ?? (pkg.departureInfo || null), pkg.duration || null].filter(Boolean).join(' · ');
const activePromo = (pkg: any) => {
  const deadline = dateOnlyKey(pkg.promoDeadline);
  return pkg.isPromo && pkg.promoDiscount && deadline && deadline >= businessDateKey() ? { text: pkg.promoDiscount as string, until: waDate(pkg.promoDeadline) } : null;
};

export function formatWaPackageSummary(pkg: any, _brandName?: string): string {
  if (!pkg) return '';
  const rooms = ([['Quad', pkg.priceQuad || pkg.price], ['Triple', pkg.priceTriple], ['Double', pkg.priceDouble], ['Bayi (di bawah 2 tahun)', pkg.priceInfant]] as const)
    .map(([label, price]) => [label, formatCatalogRupiah(price)] as const)
    .filter(([, price]) => price)
    .map(([label, price]) => `• ${label}: ${price}`);
  const dp = formatCatalogRupiah(pkg.dp);
  const promo = activePromo(pkg);
  const quota = Number(pkg.quotaRemaining);
  return waMessage(
    [`*${waTitle(pkg.name)}*`, departure(pkg) && `Berangkat ${departure(pkg)}`],
    [
      waLine('Maskapai', pkg.airline ? `${pkg.airline}${pkg.flightType === 'direct' ? ' (Direct)' : pkg.flightType === 'transit' ? ' (Transit)' : ''}` : null),
      waLine('Hotel Makkah', pkg.hotelMakkah),
      waLine('Hotel Madinah', pkg.hotelMadinah),
    ],
    rooms.length > 0 && ['*Harga per orang*', ...rooms, dp && `DP ${dp} per orang`],
    waBullets(pkg.facilitiesIncluded).length > 0 && ['*Sudah termasuk*', ...waBullets(pkg.facilitiesIncluded)],
    waBullets(pkg.facilitiesExcluded, 4).length > 0 && ['*Belum termasuk*', ...waBullets(pkg.facilitiesExcluded, 4)],
    [promo && `Promo: ${promo.text}${promo.until ? `, berlaku sampai ${promo.until}` : ''}`, quota > 0 && `Sisa kuota paket: ${quota} orang`],
    'Ada yang ingin ditanyakan dari paket ini?',
  );
}

export function formatWaPackageItinerary(pkg: any, _brandName?: string): string {
  if (!pkg) return '';
  const agenda = waBullets(pkg.itinerary, 30);
  return waMessage(
    [`*Agenda perjalanan ${waTitle(pkg.name)}*`, departure(pkg) && `Berangkat ${departure(pkg)}`],
    agenda.length ? agenda : 'Rincian agenda harian sedang disiapkan tim operasional.',
    '_Jadwal dapat menyesuaikan kondisi di lapangan._',
    'Ada agenda yang ingin ditanyakan?',
  );
}

export function formatWaFlyerCaption(pkg: any, _brandName?: string): string {
  if (!pkg) return '';
  const from = packageFromPrice(pkg);
  return waMessage(
    [`*${waTitle(pkg.name)}*`, departure(pkg) && `Berangkat ${departure(pkg)}`, from > 0 && `Harga mulai ${formatRupiah(from)} per orang`],
    'Silakan dipelajari brosurnya. Kalau ada yang ingin ditanyakan, balas saja di chat ini.',
  );
}
