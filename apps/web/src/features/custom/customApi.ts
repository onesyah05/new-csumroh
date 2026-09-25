import { useQuery } from '@tanstack/react-query';
import {
  CUSTOM_ROUTES, customDisplayStatus, customExtendNights, customHoursLeft, customMinDpTotal, customRoomsFor, customTotalNights, formatRupiah, paxSummary, type CustomRequestInput,
  type CustomRoomPrices,
} from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { waDate, waLine, waMessage, waTitle } from '../chat/waFormat';

export type CustomExtraHotel = { country: string; hotel?: string; nights: number };
export type CustomBasePackage = {
  id: number; name: string; departureDate: string | null; departureInfo?: string | null; duration?: string | null; airline?: string | null;
  flightType?: string | null; hotelMakkah?: string | null; hotelMadinah?: string | null; quotaRemaining?: number | null;
  facilitiesIncluded?: string | null; facilitiesExcluded?: string | null; itinerary?: string | null;
};

/** "10–17 Februari 2027", "28 Februari – 3 Maret 2027", atau satu tanggal. */
export function dateRange(from?: string | null, to?: string | null) {
  const start = waDate(from);
  if (!start) return null;
  if (!to || to.slice(0, 10) === from!.slice(0, 10)) return start;
  const a = new Date(from!);
  const b = new Date(to);
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('id-ID', { ...opts, timeZone: 'UTC' }).format(d);
  if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()}–${waDate(to)}`;
  if (a.getUTCFullYear() === b.getUTCFullYear()) return `${fmt(a, { day: 'numeric', month: 'long' })} – ${waDate(to)}`;
  return `${start} – ${waDate(to)}`;
}

/** Daftar "Sudah termasuk" paket katalog sebagai item layanan. */
export const packageServices = (pkg?: { facilitiesIncluded?: string | null } | null) =>
  String(pkg?.facilitiesIncluded ?? '').split('\n').map((line) => line.replace(/^[-•*\s]+/, '').trim()).filter(Boolean);

/** Baris harga per tipe kamar: jamaah × harga per jamaah. */
export function roomPriceRows(r: Pick<CustomRequest, 'paxQuad' | 'paxTriple' | 'paxDouble' | 'paxInfant'>, prices: CustomRoomPrices | null | undefined) {
  return customRoomsFor(r).map((room) => ({ ...room, price: Number(prices?.[room.key] ?? 0) }));
}
const flight = (airline?: string | null, type?: string | null) => [airline, type === 'direct' ? 'Direct' : type === 'transit' ? 'Transit' : null].filter(Boolean).join(' · ');
export type CustomRequest = {
  id: number; brandId: number; prospectId: number; status: string; mode: 'package' | 'full'; basePackageId: number | null;
  departureDate: string | null; departureDateTo: string | null; departureNote: string | null; departureCity: string | null; airline: string | null; flightType: string | null;
  paxQuad: number; paxTriple: number; paxDouble: number; paxInfant: number;
  hotelMakkah: string | null; nightsMakkah: number | null; hotelMadinah: string | null; nightsMadinah: number | null;
  extendNightsMakkah: number | null; extendNightsMadinah: number | null;
  extraHotels: CustomExtraHotel[] | null; route: string | null;
  equipment: boolean | null; fastTrain: boolean | null; tourLeader: boolean | null; muthawif: boolean | null;
  servicesRemoved: string[] | null; servicesAdded: string[] | null;
  cityTour: string | null; budgetPerPax: string | number | null; specialNeeds: string | null; notes: string | null;
  offeredPrices: CustomRoomPrices | null; floorPrices: CustomRoomPrices | null;
  offeredPrice: string | number | null; floorPrice: string | number | null; minDpPerPax: string | number | null;
  quoteValidUntil: string | null; quoteNote: string | null; quotedAt: string | null; revisionNote: string | null;
  returnNote: string | null; queuedAt: string | null; quoteCount: number; minDpInfant: string | number | null;
  claimedById?: number | null; claimedAt?: string | null; claimedBy?: { id: number; name: string } | null;
  agreedPrice: string | number | null; agreedAt: string | null; createdAt: string; updatedAt: string;
  prospect?: {
    id: number; name: string; phone: string | null; status: string; userId: number | null; brandId: number; user?: { name: string } | null;
    offerSentAt?: string | null; invoiceSentAt?: string | null; invoiceNumber?: string | null;
  };
  brand?: { id: number; name: string; code: string; logoUrl?: string | null };
  basePackage?: CustomBasePackage | null;
  createdBy?: { name: string } | null;
  quotedBy?: { name: string } | null;
};

/** Permintaan custom aktif prospek; kunci di bawah ['prospect', id] ikut segar oleh event prospek. */
export function useProspectCustom(prospectId: number, brandId?: number) {
  return useQuery({
    queryKey: ['prospect', prospectId, 'custom'],
    queryFn: () => api.get<CustomRequest | null>(`/custom-requests/prospect/${prospectId}${brandId ? `?brandId=${brandId}` : ''}`),
    enabled: Boolean(prospectId),
  });
}

export const money = (value: unknown) => formatRupiah(Number(value ?? 0));
export const minDpTotal = (r: CustomRequest) => customMinDpTotal(r);

/** "5 jam lagi", "2 hari lagi" (dibulatkan ke bawah, minimal 1 satuan). */
export function timeLeftLabel(hours: number) {
  if (hours < 1) return `${Math.max(1, Math.floor(hours * 60))} menit lagi`;
  if (hours < 24) return `${Math.floor(hours)} jam lagi`;
  return `${Math.floor(hours / 24)} hari lagi`;
}
/** "12 menit", "3 jam", "2 hari" sejak waktu tertentu. */
export function sinceLabel(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  return minutes < 60 ? `${minutes} menit` : minutes < 1440 ? `${Math.round(minutes / 60)} jam` : `${Math.round(minutes / 1440)} hari`;
}
export const validUntilLabel = (value: string) =>
  `${new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(value))} WIB`;

/** Rincian kebutuhan dikelompokkan agar mudah dipindai (Tim LA, kartu CS, langkah periksa). */
export function customSpecGroups(r: CustomRequest, basePackage: CustomBasePackage | null = r.basePackage ?? null) {
  const rows = customSpecRows(r, basePackage);
  const groups: Array<{ title: string; labels: RegExp }> = [
    { title: 'Perjalanan', labels: /^(Jenis|Paket|Berangkat|Dari|Pesawat|Rute)$/ },
    { title: 'Jamaah', labels: /^Jamaah$/ },
    { title: 'Hotel & malam', labels: /^(Extend|Hotel .+|Makkah|Madinah|Total tambahan|Total|Tambah .+)$/ },
    { title: 'Layanan', labels: /^(Layanan dikurangi|Layanan ditambah|Termasuk|City tour)$/ },
    { title: 'Budget & catatan', labels: /^(Budget|Kebutuhan khusus|Catatan)$/ },
  ];
  const used = new Set<string>();
  const out = groups.map((group) => {
    const picked = rows.filter(([label]) => group.labels.test(label));
    picked.forEach(([label]) => used.add(label));
    return { title: group.title, rows: picked };
  });
  // Negara tambahan full custom memakai nama negara sebagai label: masuk ke Hotel & malam.
  const rest = rows.filter(([label]) => !used.has(label));
  if (rest.length) out[2]!.rows.push(...rest);
  return out.filter((group) => group.rows.length);
}

const yes = (value: boolean | null) => value === true;
export function customServices(r: CustomRequest) {
  return [yes(r.fastTrain) && 'Kereta cepat', yes(r.equipment) && 'Perlengkapan', yes(r.tourLeader) && 'Tour leader', yes(r.muthawif) && 'Muthowif'].filter(Boolean) as string[];
}

/** Baris ringkas kebutuhan (label, nilai) untuk kartu CS dan antrean Tim LA. */
export function customSpecRows(r: CustomRequest, basePackage: CustomBasePackage | null = r.basePackage ?? null): Array<[string, string]> {
  const extras = Array.isArray(r.extraHotels) ? r.extraHotels : [];
  const services: Array<[string, string | null | undefined]> = r.mode === 'package'
    ? [['Layanan dikurangi', (r.servicesRemoved ?? []).join(', ') || null], ['Layanan ditambah', (r.servicesAdded ?? []).join(', ') || null]]
    : [['Termasuk', customServices(r).join(', ') || 'Tanpa tambahan']];
  const tail: Array<[string, string | null | undefined]> = [
    ...services,
    ['City tour', r.cityTour ? `Standar + ${r.cityTour}` : 'Standar Makkah & Madinah'],
    ['Budget', r.budgetPerPax ? `${money(r.budgetPerPax)} per orang` : null],
    ['Kebutuhan khusus', r.specialNeeds],
    ['Catatan', r.notes],
  ];
  const keep = (rows: Array<[string, string | null | undefined]>) => rows.filter((row): row is [string, string] => Boolean(row[1]));
  if (r.mode === 'package') {
    const pkg = basePackage;
    const extend = [r.extendNightsMakkah && `Makkah +${r.extendNightsMakkah} malam`, r.extendNightsMadinah && `Madinah +${r.extendNightsMadinah} malam`].filter(Boolean).join(', ');
    const departure = [waDate(r.departureDate ?? pkg?.departureDate) ?? pkg?.departureInfo, pkg?.duration].filter(Boolean).join(' · ');
    return keep([
      ['Jenis', 'Berbasis paket'],
      ['Paket', pkg?.name],
      ['Berangkat', departure ? `${departure} (sesuai paket)` : null],
      ['Pesawat', pkg ? flight(pkg.airline, pkg.flightType) || 'Sesuai paket' : null],
      ['Jamaah', paxSummary(r)],
      ['Extend', extend || 'Tidak ada'],
      ['Hotel Makkah', r.hotelMakkah ? `Ganti: ${r.hotelMakkah}` : `Sesuai paket${pkg?.hotelMakkah ? ` (${pkg.hotelMakkah})` : ''}`],
      ['Hotel Madinah', r.hotelMadinah ? `Ganti: ${r.hotelMadinah}` : `Sesuai paket${pkg?.hotelMadinah ? ` (${pkg.hotelMadinah})` : ''}`],
      ...extras.map((row) => [`Tambah ${row.country}`, `${row.hotel || 'Hotel bebas'} · ${row.nights} malam`] as [string, string]),
      ['Total tambahan', customExtendNights(r) ? `${customExtendNights(r)} malam` : null],
      ...tail,
    ]);
  }
  const nights = customTotalNights(r);
  return keep([
    ['Jenis', 'Full custom'],
    ['Berangkat', [dateRange(r.departureDate, r.departureDateTo), r.departureNote].filter(Boolean).join(' · ')],
    ['Dari', r.departureCity],
    ['Jamaah', paxSummary(r)],
    ['Pesawat', flight(r.airline, r.flightType)],
    ['Makkah', r.hotelMakkah || r.nightsMakkah ? `${r.hotelMakkah || 'Hotel bebas'}${r.nightsMakkah ? ` · ${r.nightsMakkah} malam` : ''}` : null],
    ['Madinah', r.hotelMadinah || r.nightsMadinah ? `${r.hotelMadinah || 'Hotel bebas'}${r.nightsMadinah ? ` · ${r.nightsMadinah} malam` : ''}` : null],
    ...extras.map((row) => [`Hotel ${row.country}`, `${row.hotel || 'Hotel bebas'} · ${row.nights} malam`] as [string, string]),
    ['Total', nights ? `${nights} malam` : null],
    ['Rute', r.route ? CUSTOM_ROUTES.find((item) => item.value === r.route)?.label ?? r.route : null],
    ...tail,
  ]);
}

/** Naskah penawaran resmi layanan custom: hanya nilai deal akhir, tanpa harga terendah Tim LA. */
/** Naskah penawaran resmi layanan custom: hanya nilai deal akhir, tanpa harga terendah Tim LA. */
export function formatCustomOffer(r: CustomRequest, agreedPrice: number, note?: string, basePackage: CustomBasePackage | null = r.basePackage ?? null) {
  const extras = Array.isArray(r.extraHotels) ? r.extraHotels : [];
  const services = customServices(r);
  // Rincian per tipe kamar (harga ditawarkan per jamaah); selisih dengan nilai deal ditulis sebagai potongan khusus.
  const offeredTotal = Number(r.offeredPrice ?? 0);
  const discount = offeredTotal - agreedPrice;
  const rooms = roomPriceRows(r, r.offeredPrices).filter((room) => room.price > 0);
  const cost = [
    '*Rincian biaya*',
    ...(rooms.length ? rooms.map((room) => `• ${room.label} ${room.pax} × ${money(room.price)}`) : [`• Jamaah: ${paxSummary(r)}`]),
    rooms.length > 0 && discount > 0 && `• Potongan khusus: −${money(discount)}`,
    `*Total: ${money(agreedPrice)}*`,
  ];
  const closing = [
    r.status === 'quoted' && r.quoteValidUntil && `Harga berlaku sampai ${new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(r.quoteValidUntil))} WIB.`,
    note?.trim() && `Catatan: ${note.trim()}`,
    'Apakah rincian ini sudah sesuai?',
  ] as const;
  if (r.mode === 'package') {
    const pkg = basePackage;
    const extend = customExtendNights(r);
    const plus = (n: number | null) => (n ? ` (+${n} malam)` : '');
    return waMessage(
      'Berikut penawaran umroh yang disesuaikan untuk Bapak/Ibu:',
      [
        `*${waTitle(pkg?.name)}* (disesuaikan)`,
        waLine('Berangkat', [waDate(r.departureDate ?? pkg?.departureDate) ?? pkg?.departureInfo, pkg?.duration && `${pkg.duration}${extend ? ` + ${extend} malam` : ''}`].filter(Boolean).join(' · ')),
        waLine('Pesawat', pkg ? flight(pkg.airline, pkg.flightType) : null),
        waLine('Hotel Makkah', r.hotelMakkah || pkg?.hotelMakkah ? `${r.hotelMakkah || pkg?.hotelMakkah}${plus(r.extendNightsMakkah)}` : null),
        waLine('Hotel Madinah', r.hotelMadinah || pkg?.hotelMadinah ? `${r.hotelMadinah || pkg?.hotelMadinah}${plus(r.extendNightsMadinah)}` : null),
        ...extras.map((row) => waLine(`Hotel ${row.country}`, `${row.hotel || 'sesuai konfirmasi'} (${row.nights} malam)`)),
      ],
      ((r.servicesAdded ?? []).length > 0 || (r.servicesRemoved ?? []).length > 0 || Boolean(r.cityTour)) && [
        '*Penyesuaian layanan*',
        (r.servicesAdded ?? []).length > 0 && `• Ditambah: ${(r.servicesAdded ?? []).join(', ')}`,
        (r.servicesRemoved ?? []).length > 0 && `• Tidak termasuk: ${(r.servicesRemoved ?? []).join(', ')}`,
        r.cityTour && `• City tour tambahan: ${r.cityTour}`,
      ],
      cost,
      ...closing,
    );
  }
  const nights = customTotalNights(r);
  return waMessage(
    'Berikut penawaran umroh custom sesuai kebutuhan Bapak/Ibu:',
    [
      waLine('Berangkat', [dateRange(r.departureDate, r.departureDateTo), r.departureNote].filter(Boolean).join(' · ') + (r.departureCity ? ` dari ${r.departureCity}` : '')),
      waLine('Pesawat', flight(r.airline, r.flightType)),
      waLine('Hotel Makkah', r.hotelMakkah ? `${r.hotelMakkah}${r.nightsMakkah ? ` (${r.nightsMakkah} malam)` : ''}` : null),
      waLine('Hotel Madinah', r.hotelMadinah ? `${r.hotelMadinah}${r.nightsMadinah ? ` (${r.nightsMadinah} malam)` : ''}` : null),
      ...extras.map((row) => waLine(`Hotel ${row.country}`, `${row.hotel || 'sesuai konfirmasi'} (${row.nights} malam)`)),
      nights ? `Total ${nights} malam` : null,
      waLine('Rute', r.route ? CUSTOM_ROUTES.find((item) => item.value === r.route)?.label : null),
    ],
    services.length > 0 && ['*Sudah termasuk*', ...services.map((item) => `• ${item}`), '• City tour Makkah & Madinah' + (r.cityTour ? `, ditambah ${r.cityTour}` : '')],
    cost,
    ...closing,
  );
}

export const emptyCustomInput = (pax: { paxQuad?: number; paxTriple?: number; paxDouble?: number; paxInfant?: number }, mode: CustomRequestInput['mode'] = 'package'): CustomRequestInput => ({
  mode, basePackageId: null, extendNightsMakkah: null, extendNightsMadinah: null, departureDateTo: null, servicesRemoved: [], servicesAdded: [], departureDate: null, departureNote: null, departureCity: null, airline: null, flightType: null,
  paxQuad: pax.paxQuad ?? 0, paxTriple: pax.paxTriple ?? 0, paxDouble: pax.paxDouble ?? 0, paxInfant: pax.paxInfant ?? 0,
  hotelMakkah: null, nightsMakkah: null, hotelMadinah: null, nightsMadinah: null, extraHotels: [], route: null,
  equipment: false, fastTrain: false, tourLeader: false, muthawif: false, cityTour: null, budgetPerPax: null, specialNeeds: null, notes: null,
});

export function customToInput(r: CustomRequest): CustomRequestInput {
  return {
    mode: r.mode, basePackageId: r.basePackageId, extendNightsMakkah: r.extendNightsMakkah, extendNightsMadinah: r.extendNightsMadinah,
    departureDateTo: r.departureDateTo ? r.departureDateTo.slice(0, 10) : null, servicesRemoved: r.servicesRemoved ?? [], servicesAdded: r.servicesAdded ?? [], departureDate: r.departureDate ? r.departureDate.slice(0, 10) : null, departureNote: r.departureNote,
    departureCity: r.departureCity, airline: r.airline, flightType: (r.flightType as 'direct' | 'transit' | null) ?? null,
    paxQuad: r.paxQuad, paxTriple: r.paxTriple, paxDouble: r.paxDouble, paxInfant: r.paxInfant,
    hotelMakkah: r.hotelMakkah, nightsMakkah: r.nightsMakkah, hotelMadinah: r.hotelMadinah, nightsMadinah: r.nightsMadinah,
    extraHotels: (r.extraHotels ?? []).map((row) => ({ country: row.country, hotel: row.hotel ?? '', nights: row.nights })),
    route: (r.route as 'makkah_first' | 'madinah_first' | null) ?? null,
    equipment: r.equipment, fastTrain: r.fastTrain, tourLeader: r.tourLeader, muthawif: r.muthawif,
    cityTour: r.cityTour, budgetPerPax: r.budgetPerPax ? Number(r.budgetPerPax) : null, specialNeeds: r.specialNeeds, notes: r.notes,
  };
}

/** Label ringkas status custom untuk daftar (Pipeline, percakapan, detail prospek); `urgent` = perlu tindakan CS. */
export function customBadge(active?: { status: string; quoteValidUntil?: string | null } | null) {
  if (!active || active.status === 'cancelled') return null;
  const status = customDisplayStatus(active);
  const hours = status === 'quoted' ? customHoursLeft(active.quoteValidUntil) : null;
  if (status === 'needs_info') return { text: 'Custom: perlu dilengkapi', urgent: true };
  if (status === 'expired') return { text: 'Custom: harga kedaluwarsa', urgent: true };
  if (status === 'quoted') return hours !== null && hours < 24 ? { text: `Custom: berakhir ${timeLeftLabel(hours)}`, urgent: true } : { text: 'Custom: harga siap', urgent: false };
  if (status === 'agreed') return { text: 'Custom: disepakati', urgent: false };
  return { text: 'Custom: menunggu Tim LA', urgent: false };
}
