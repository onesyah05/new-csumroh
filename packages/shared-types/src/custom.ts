import { z } from 'zod';

/**
 * Layanan Custom: kebutuhan khusus jamaah → Tim LA menghitung harga → CS negosiasi → Deal lewat alur biasa
 * (penawaran, invoice pembayaran, verifikasi Finance).
 *
 * Aturan harga (keputusan holding):
 * - Tim LA mengisi harga ditawarkan & harga terendah PER JAMAAH untuk setiap tipe kamar yang dipilih
 *   (Quad/Triple/Double/Bayi); totalnya dihitung sistem. DP minimal per jamaah.
 * - CS boleh melihat harga terendah; nilai deal akhir diisi CS dan DITOLAK bila di bawah harga terendah.
 * - Harga berlaku 3 hari kecuali Tim LA menetapkan tanggal lain.
 * - Boleh berbasis paket katalog; kuota paket dasar tetap dipotong saat Deal.
 */
export const CUSTOM_STATUSES = ['submitted', 'needs_info', 'quoted', 'revision_requested', 'agreed', 'cancelled'] as const;
export type CustomStatus = (typeof CUSTOM_STATUSES)[number];
/** Status tampilan: `expired` = harga sudah dihitung tetapi masa berlakunya lewat. */
export type CustomDisplayStatus = CustomStatus | 'expired';

export const CUSTOM_STATUS_LABELS: Record<CustomDisplayStatus, string> = {
  submitted: 'Menunggu hitungan Tim LA',
  needs_info: 'Dikembalikan ke CS',
  revision_requested: 'Menunggu hitung ulang',
  quoted: 'Harga sudah dihitung',
  expired: 'Harga kedaluwarsa',
  agreed: 'Harga disepakati',
  cancelled: 'Dibatalkan',
};

export const CUSTOM_ROUTES = [
  { value: 'makkah_first', label: 'Makkah dulu' },
  { value: 'madinah_first', label: 'Madinah dulu' },
] as const;
export const CUSTOM_FLIGHT_TYPES = [
  { value: 'direct', label: 'Direct' },
  { value: 'transit', label: 'Transit' },
] as const;
export const CUSTOM_DEFAULT_VALIDITY_DAYS = 3;
/** Tambahan layanan yang sering diminta; layanan lain ditulis bebas. */
export const CUSTOM_ADD_ONS = ['Kereta cepat', 'Perlengkapan', 'Tour leader', 'Muthowif'] as const;

/** Tipe kamar yang dihargai Tim LA (per jamaah). */
export const CUSTOM_ROOMS = [
  { key: 'quad', paxKey: 'paxQuad', label: 'Quad' },
  { key: 'triple', paxKey: 'paxTriple', label: 'Triple' },
  { key: 'double', paxKey: 'paxDouble', label: 'Double' },
  { key: 'infant', paxKey: 'paxInfant', label: 'Bayi' },
] as const;
export type CustomRoomKey = (typeof CUSTOM_ROOMS)[number]['key'];
export type CustomRoomPrices = Partial<Record<CustomRoomKey, number>>;

/**
 * Jenis permintaan:
 * - `package`: berbasis paket katalog. Tanggal berangkat & pesawat mengikuti paket; yang diubah biasanya extend
 *   malam, ganti hotel, atau ubah layanan.
 * - `full`: semua komponen ditentukan dari kebutuhan jamaah.
 */
export const CUSTOM_MODES = [
  { value: 'package', label: 'Berbasis paket', description: 'Tanggal berangkat mengikuti paket. Ubah: extend malam, ganti hotel, atau layanan.' },
  { value: 'full', label: 'Full custom', description: 'Tanggal, pesawat, hotel, dan rute ditentukan sesuai kebutuhan jamaah.' },
] as const;
export type CustomMode = (typeof CUSTOM_MODES)[number]['value'];

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const nights = z.coerce.number().int().min(0).max(60).nullable().optional();
const pax = z.coerce.number().int().min(0).max(200).default(0);

export const customExtraHotelSchema = z.object({
  country: z.string().trim().min(1, 'Negara wajib diisi.').max(60),
  hotel: z.string().trim().max(150).optional().default(''),
  nights: z.coerce.number().int().min(1).max(60),
});

export const customRequestInputSchema = z.object({
  mode: z.enum(['package', 'full']),
  basePackageId: z.number().int().positive().nullable().optional(),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('')).transform((v) => v || null),
  /** Full custom: akhir rentang tanggal berangkat; kosong = tanggal pasti. */
  departureDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('')).transform((v) => v || null),
  departureNote: optionalText(100),
  departureCity: optionalText(100),
  airline: optionalText(100),
  flightType: z.enum(['direct', 'transit']).nullable().optional(),
  paxQuad: pax,
  paxTriple: pax,
  paxDouble: pax,
  paxInfant: pax,
  hotelMakkah: optionalText(150),
  nightsMakkah: nights,
  hotelMadinah: optionalText(150),
  nightsMadinah: nights,
  /** Berbasis paket: tambahan malam di luar durasi paket. */
  extendNightsMakkah: nights,
  extendNightsMadinah: nights,
  extraHotels: z.array(customExtraHotelSchema).max(5).default([]),
  route: z.enum(['makkah_first', 'madinah_first']).nullable().optional(),
  equipment: z.boolean().nullable().optional(),
  fastTrain: z.boolean().nullable().optional(),
  tourLeader: z.boolean().nullable().optional(),
  muthawif: z.boolean().nullable().optional(),
  /** Berbasis paket: layanan paket yang tidak diambil / layanan yang ditambahkan. */
  servicesRemoved: z.array(z.string().trim().min(1).max(150)).max(30).default([]),
  servicesAdded: z.array(z.string().trim().min(1).max(150)).max(30).default([]),
  cityTour: optionalText(2000),
  budgetPerPax: z.coerce.number().positive().nullable().optional(),
  specialNeeds: optionalText(2000),
  notes: optionalText(2000),
}).superRefine((value, ctx) => {
  if (value.paxQuad + value.paxTriple + value.paxDouble < 1) {
    ctx.addIssue({ code: 'custom', path: ['paxQuad'], message: 'Isi minimal 1 jamaah dewasa.' });
  }
  if (value.mode === 'package' && !value.basePackageId) {
    ctx.addIssue({ code: 'custom', path: ['basePackageId'], message: 'Pilih paket dasar.' });
  }
  if (value.mode === 'full' && !value.departureDate) {
    ctx.addIssue({ code: 'custom', path: ['departureDate'], message: 'Isi tanggal keberangkatan atau rentang tanggalnya.' });
  }
  if (value.departureDate && value.departureDateTo && value.departureDateTo < value.departureDate) {
    ctx.addIssue({ code: 'custom', path: ['departureDateTo'], message: 'Akhir rentang tanggal tidak boleh sebelum tanggal awal.' });
  }
});
export type CustomRequestInput = z.infer<typeof customRequestInputSchema>;

const roomPrices = z.object({
  quad: z.number().positive().optional(), triple: z.number().positive().optional(),
  double: z.number().positive().optional(), infant: z.number().positive().optional(),
});
export const customQuoteSchema = z.object({
  /** Per jamaah, untuk tipe kamar yang ada jamaahnya. */
  offeredPrices: roomPrices,
  floorPrices: roomPrices,
  minDpPerPax: z.number().positive('DP minimal wajib diisi.'),
  /** DP minimal per bayi (boleh 0); wajib bila ada bayi. */
  minDpInfant: z.number().min(0).nullable().optional(),
  /** YYYY-MM-DD; kosong = 3 hari dari sekarang. */
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('')).transform((v) => v || null),
  note: optionalText(2000),
}).superRefine((value, ctx) => {
  for (const room of CUSTOM_ROOMS) {
    const offered = value.offeredPrices[room.key];
    const floor = value.floorPrices[room.key];
    if (offered && floor && floor > offered) {
      ctx.addIssue({ code: 'custom', path: ['floorPrices', room.key], message: `Harga terendah ${room.label} tidak boleh di atas harga ditawarkan.` });
    }
  }
});
export type CustomQuoteInput = z.infer<typeof customQuoteSchema>;

export const customAgreeSchema = z.object({ agreedPrice: z.number().positive('Nilai deal akhir wajib diisi.') });
export const customRevisionSchema = z.object({ note: z.string().trim().min(3, 'Tulis apa yang berubah.').max(2000) });
/** Tim LA mengembalikan permintaan ke CS (data kurang, hotel penuh, tanggal tidak tersedia). */
export const customReturnSchema = z.object({ note: z.string().trim().min(5, 'Tulis apa yang perlu dilengkapi CS.').max(2000) });

type CustomPax = { paxQuad?: number | null; paxTriple?: number | null; paxDouble?: number | null; paxInfant?: number | null };
/** Jamaah permintaan custom (dewasa + bayi): dasar DP minimal per jamaah. */
export const customPaxTotal = (p: CustomPax) => (p.paxQuad ?? 0) + (p.paxTriple ?? 0) + (p.paxDouble ?? 0) + (p.paxInfant ?? 0);
/** DP minimal total = dewasa × DP dewasa + bayi × DP bayi (DP bayi kosong = sama dengan dewasa). */
export function customMinDpTotal(r: CustomPax & { minDpPerPax?: unknown; minDpInfant?: unknown }) {
  const adult = Number(r.minDpPerPax ?? 0);
  const infant = r.minDpInfant === null || r.minDpInfant === undefined ? adult : Number(r.minDpInfant);
  const adults = (r.paxQuad ?? 0) + (r.paxTriple ?? 0) + (r.paxDouble ?? 0);
  return Math.round(adult * adults + infant * (r.paxInfant ?? 0));
}
/** Tipe kamar yang ada jamaahnya (urutan Quad, Triple, Double, Bayi). */
export const customRoomsFor = (p: CustomPax) => CUSTOM_ROOMS.filter((room) => (p[room.paxKey] ?? 0) > 0).map((room) => ({ ...room, pax: p[room.paxKey] ?? 0 }));
/** Total = Σ harga per jamaah × jamaah per tipe kamar. `null` bila ada tipe kamar yang belum dihargai. */
export function customRoomTotal(prices: unknown, p: CustomPax) {
  const map = (prices && typeof prices === 'object' ? prices : {}) as Record<string, unknown>;
  let total = 0;
  for (const room of customRoomsFor(p)) {
    const price = Number(map[room.key] ?? 0);
    if (!(price > 0)) return null;
    total += price * room.pax;
  }
  return Math.round(total);
}
export const samePax = (a: CustomPax, b: CustomPax) =>
  (['paxQuad', 'paxTriple', 'paxDouble', 'paxInfant'] as const).every((key) => (a[key] ?? 0) === (b[key] ?? 0));

/** Total malam dari Makkah, Madinah, dan hotel negara tambahan. */
export function customTotalNights(r: { mode?: string | null; nightsMakkah?: number | null; nightsMadinah?: number | null; extraHotels?: unknown }) {
  const extra = Array.isArray(r.extraHotels) ? r.extraHotels.reduce((sum: number, row: any) => sum + (Number(row?.nights) || 0), 0) : 0;
  // Berbasis paket: durasi dasar mengikuti paket; yang dihitung di sini hanya tambahannya.
  if (r.mode === 'package') return extra;
  return (r.nightsMakkah ?? 0) + (r.nightsMadinah ?? 0) + extra;
}

/** Total malam tambahan (extend + negara tambahan) untuk permintaan berbasis paket. */
export function customExtendNights(r: { extendNightsMakkah?: number | null; extendNightsMadinah?: number | null; extraHotels?: unknown }) {
  const extra = Array.isArray(r.extraHotels) ? r.extraHotels.reduce((sum: number, row: any) => sum + (Number(row?.nights) || 0), 0) : 0;
  return (r.extendNightsMakkah ?? 0) + (r.extendNightsMadinah ?? 0) + extra;
}

/** Jam tersisa sebelum harga kedaluwarsa (null bila tidak ada batas). */
export function customHoursLeft(validUntil: string | Date | null | undefined, now = new Date()) {
  if (!validUntil) return null;
  return (new Date(validUntil).getTime() - now.getTime()) / 3_600_000;
}

export function customDisplayStatus(r: { status: string; quoteValidUntil?: string | Date | null }, now = new Date()): CustomDisplayStatus {
  if (r.status === 'quoted' && r.quoteValidUntil && new Date(r.quoteValidUntil).getTime() < now.getTime()) return 'expired';
  return r.status as CustomDisplayStatus;
}

/** Permintaan yang masih berjalan (satu per prospek). */
export const isActiveCustom = (r: { status: string } | null | undefined) => Boolean(r && r.status !== 'cancelled');

/** Label status sesuai sudut pandang pembaca: CS (pemilik jamaah) atau Tim LA (penghitung harga). */
export function customStatusLabel(status: CustomDisplayStatus, view: 'cs' | 'la') {
  if (view === 'cs') {
    if (status === 'needs_info') return 'Perlu Anda lengkapi';
    if (status === 'revision_requested') return 'Menunggu hitung ulang Tim LA';
  } else {
    if (status === 'submitted') return 'Perlu dihitung';
    if (status === 'revision_requested') return 'Perlu dihitung ulang';
  }
  return CUSTOM_STATUS_LABELS[status];
}
