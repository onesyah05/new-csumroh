export function formatWaPackageSummary(pkg: any, brandName?: string): string {
  if (!pkg) return '';
  const departureStr = pkg.departureDate
    ? new Date(pkg.departureDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
    : (pkg.departureInfo || 'Sesuai Jadwal Musim');
  const durationStr = pkg.duration ? `${pkg.duration}` : '9 Hari';
  const airlineStr = pkg.airline ? `${pkg.airline}${pkg.flightType === 'direct' ? ' (Direct Flight)' : ''}` : 'Penerbangan Reguler';
  const travelName = brandName || pkg.brand?.name || 'Layanan Resmi Umroh';

  const incItems = (pkg.facilitiesIncluded || '')
    .split('\n')
    .map((s: string) => s.trim())
    .filter(Boolean);

  let text = `*${(pkg.name || 'PAKET UMROH').toUpperCase()}*\n`;
  text += `Travel: ${travelName}\n\n`;
  text += `📅 Keberangkatan: ${departureStr} (${durationStr})\n`;
  text += `✈️ Maskapai: ${airlineStr}\n`;
  if (pkg.hotelMakkah) text += `🏨 Hotel Makkah: ${pkg.hotelMakkah}\n`;
  if (pkg.hotelMadinah) text += `🏨 Hotel Madinah: ${pkg.hotelMadinah}\n`;

  text += `\n💰 *RINCIAN HARGA KAMAR:*\n`;
  if (pkg.priceQuad || pkg.price) text += `• Quad (Kamar Ber-4): Rp ${pkg.priceQuad || pkg.price}\n`;
  if (pkg.priceTriple) text += `• Triple (Kamar Ber-3): Rp ${pkg.priceTriple}\n`;
  if (pkg.priceDouble) text += `• Double (Kamar Ber-2): Rp ${pkg.priceDouble}\n`;
  if (pkg.priceInfant) text += `• Infant (< 2 Thn): Rp ${pkg.priceInfant}\n`;
  if (pkg.dp) text += `• Minimal DP: Rp ${pkg.dp}\n`;

  if (incItems.length > 0) {
    text += `\n✅ *FASILITAS INCLUDE:*\n`;
    incItems.slice(0, 6).forEach((item: string) => {
      text += `• ${item}\n`;
    });
  }

  if (pkg.isPromo) {
    text += `\n🎁 *PROMO KHUSUS:* Potongan ${pkg.promoDiscount || 'Spesial'}\n`;
  }

  if (pkg.quotaRemaining !== null && pkg.quotaRemaining !== undefined) {
    text += `\n🎟️ Sisa Kuota: ${pkg.quotaRemaining} Seat\n`;
  }

  text += `\nInformasi pendaftaran dan penguncian seat silakan balas pesan ini ya Kak. Bismillah kami siap melayani! 🙏`;
  return text;
}

export function formatWaPackageItinerary(pkg: any, brandName?: string): string {
  if (!pkg) return '';
  const departureStr = pkg.departureDate
    ? new Date(pkg.departureDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
    : (pkg.departureInfo || 'Sesuai Jadwal Musim');
  const durationStr = pkg.duration ? `${pkg.duration}` : '9 Hari';
  const travelName = brandName || pkg.brand?.name || 'Layanan Resmi Umroh';

  const itinLines = (pkg.itinerary || '')
    .split('\n')
    .map((s: string) => s.trim())
    .filter(Boolean);

  let text = `*${(pkg.name || 'PAKET UMROH').toUpperCase()}*\n`;
  text += `*Rundown Agenda Perjalanan*\n`;
  text += `Travel: ${travelName}\n\n`;
  text += `📅 Keberangkatan: ${departureStr} (${durationStr})\n`;
  if (pkg.airline) text += `✈️ Penerbangan: ${pkg.airline}\n\n`;

  text += `🕋 *AGENDA HARIAN:*\n`;
  if (itinLines.length > 0) {
    itinLines.forEach((line: string) => {
      text += `• ${line}\n`;
    });
  } else {
    text += `_Rincian agenda harian ziarah sedang disiapkan oleh tim operasional._\n`;
  }

  text += `\n_Catatan: Jadwal dapat disesuaikan dengan kondisi lapangan demi kelancaran ibadah jamaah._\n\n`;
  text += `Ada agenda atau kegiatan yang ingin ditanyakan lebih detail, Kak? Kami siap membantu! 🙏`;
  return text;
}

export function formatWaFlyerCaption(pkg: any, brandName?: string): string {
  if (!pkg) return '';
  const travelName = brandName || pkg.brand?.name || 'Layanan Resmi Umroh';
  let cleanTitle = (pkg.name || '').trim();
  if (!cleanTitle.match(/^paket\s+/i)) {
    cleanTitle = cleanTitle.match(/^umroh\s+/i) ? ('Paket ' + cleanTitle) : ('Paket Umroh ' + cleanTitle);
  }

  let text = `*${cleanTitle.toUpperCase()}*\n`;
  text += `Travel: ${travelName}\n\n`;
  text += `📅 Jadwal: ${pkg.departureDate ? new Date(pkg.departureDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : (pkg.departureInfo || '-')} (${pkg.duration || '9 Hari'})\n`;
  text += `✈️ Maskapai: ${pkg.airline || '-'}\n`;
  if (pkg.hotelMakkah) text += `🏨 Hotel Makkah: ${pkg.hotelMakkah}\n`;
  if (pkg.hotelMadinah) text += `🏨 Hotel Madinah: ${pkg.hotelMadinah}\n`;
  text += `💰 Quad Mulai: Rp ${pkg.priceQuad || pkg.price}\n\n`;
  text += `Berikut brosur & flyer resmi perjalanannya ya Kak. Silakan dipelajari detail jadwal & fasilitasnya, jika ada yang ingin ditanyakan silakan balas pesan ini ya Kak 🙏`;
  return text;
}
