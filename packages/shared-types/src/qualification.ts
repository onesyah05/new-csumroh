import { isLostStatus, isWonStatus, packageBookingValue, parseRupiah } from './business.js';

/**
 * Kualifikasi calon jamaah: syarat sebelum penawaran. Satu sumber aturan untuk API (naik tahap otomatis
 * dan penjaga) serta ketiga form (Inbox, modal Pipeline, halaman detail).
 *
 * Isian boleh diisi bertahap; status naik ke Terkualifikasi hanya bila SEMUA terisi: bulan keberangkatan,
 * minimal 1 jamaah dewasa (Quad/Triple/Double), budget per orang, dan status paspor.
 * Bayi tidak dihitung karena tidak berangkat sendiri dan tidak memakai seat. Tipe kamar utama tidak
 * diisi terpisah: diturunkan dari rincian jamaah per tipe kamar.
 */
type Pax = { paxQuad?: number | null; paxTriple?: number | null; paxDouble?: number | null; paxInfant?: number | null };

export const adultPaxOf = (p: Pax) => Math.max(0, p.paxQuad ?? 0) + Math.max(0, p.paxTriple ?? 0) + Math.max(0, p.paxDouble ?? 0);

/** Tipe kamar dengan jamaah dewasa terbanyak (seri: Quad, Triple, lalu Double). */
export function primaryRoomOf(p: Pax): 'Quad' | 'Triple' | 'Double' | null {
  const rooms = [['Quad', p.paxQuad ?? 0], ['Triple', p.paxTriple ?? 0], ['Double', p.paxDouble ?? 0]] as const;
  const [room, count] = rooms.reduce((best, row) => (row[1] > best[1] ? row : best));
  return count > 0 ? room : null;
}

type QualificationInput = Pax & { targetMonth?: string | null; budgetRange?: string | null; passportStatus?: string | null };
export function qualificationMissing(p: QualificationInput) {
  const missing: string[] = [];
  if (!p.targetMonth?.trim()) missing.push('Bulan keberangkatan');
  if (adultPaxOf(p) < 1) missing.push('Minimal 1 jamaah dewasa');
  if (!p.budgetRange?.trim()) missing.push('Budget');
  if (!p.passportStatus?.trim()) missing.push('Paspor');
  return missing;
}
export const isQualificationComplete = (p: QualificationInput) => qualificationMissing(p).length === 0;

/** Tahap setelah Terkualifikasi (sebelum Deal): syarat kualifikasi tidak boleh dihapus. */
export const QUALIFIED_ONWARD = ['qualified', 'offer', 'offered', 'objection', 'followup', 'nurture', 'closing'] as const;

// ── Bulan keberangkatan: disimpan "YYYY-MM" dengan label musim opsional ("2027-02 Ramadan"). ──
export const TARGET_SEASONS = ['Ramadan', 'Syawal', 'Liburan sekolah', 'Akhir tahun', 'Awal musim'] as const;
const TARGET_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])(?:\s+(.{1,40}))?$/;

export function parseTargetMonth(value?: string | null) {
  const text = value?.trim() ?? '';
  const match = TARGET_PATTERN.exec(text);
  if (!match) return { key: null, season: null, legacy: text || null };
  return { key: `${match[1]}-${match[2]}`, season: match[3] ?? null, legacy: null };
}
export const isStructuredTargetMonth = (value?: string | null) => parseTargetMonth(value).key !== null;
export const formatTargetMonth = (key: string, season?: string | null) => (season ? `${key} ${season}` : key);

const monthName = (key: string) => {
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year!, month! - 1, 1)));
};
/** Teks tampilan: "Februari 2027 · Ramadan"; data lama (teks bebas) tampil apa adanya. */
export function targetMonthLabel(value?: string | null) {
  const parsed = parseTargetMonth(value);
  if (!parsed.key) return parsed.legacy;
  return parsed.season ? `${monthName(parsed.key)} · ${parsed.season}` : monthName(parsed.key);
}

/** Bulan ini (WIB) dan 11 bulan berikutnya, untuk pilihan bulan keberangkatan. */
export function upcomingTargetMonths(now = new Date(), count = 12) {
  const wib = new Date(now.getTime() + 7 * 3_600_000);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth() + i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return { value: key, label: monthName(key) };
  });
}

// ── Pilihan baku ──
/** Budget per orang; `max` dipakai untuk mencocokkan harga paket. */
export const BUDGET_OPTIONS = [
  { value: '< 25 Juta', label: '< Rp 25 juta', max: 25_000_000 },
  { value: '25–30 Juta', label: 'Rp 25–30 juta', max: 30_000_000 },
  { value: '30–35 Juta', label: 'Rp 30–35 juta', max: 35_000_000 },
  { value: '35–40 Juta', label: 'Rp 35–40 juta', max: 40_000_000 },
  { value: '40–50 Juta', label: 'Rp 40–50 juta', max: 50_000_000 },
  { value: '> 50 Juta', label: '> Rp 50 juta', max: Number.POSITIVE_INFINITY },
] as const;
export const DECISION_MAKER_OPTIONS = [
  { value: 'sendiri', label: 'Sendiri' },
  { value: 'pasangan', label: 'Pasangan' },
  { value: 'anak', label: 'Anak' },
  { value: 'orang_tua', label: 'Orang tua' },
  { value: 'ketua_rombongan', label: 'Ketua rombongan' },
] as const;
export const PASSPORT_OPTIONS = [
  { value: 'sudah_ada', label: 'Sudah ada' },
  { value: 'proses_buat', label: 'Proses buat' },
  { value: 'perpanjang', label: 'Perlu perpanjang' },
  { value: 'belum_ada', label: 'Belum ada' },
] as const;
export const optionLabel = (options: readonly { value: string; label: string }[], value?: string | null) =>
  options.find((o) => o.value === value)?.label ?? value ?? null;

// ── Peringatan paspor ──
export const PASSPORT_WARNING_WEEKS = 6;
/** Paspor belum siap padahal keberangkatan (paket atau awal bulan target) kurang dari 6 minggu lagi. */
export function passportWarning(input: { passportStatus?: string | null; departure?: Date | null; targetMonth?: string | null }, now = new Date()) {
  if (!input.passportStatus || input.passportStatus === 'sudah_ada') return null;
  const key = parseTargetMonth(input.targetMonth).key;
  const departure = input.departure ?? (key ? new Date(`${key}-01T00:00:00.000Z`) : null);
  if (!departure) return null;
  const weeks = (departure.getTime() - now.getTime()) / (7 * 86_400_000);
  if (weeks > PASSPORT_WARNING_WEEKS) return null;
  return `Berangkat < ${PASSPORT_WARNING_WEEKS} minggu, paspor ${optionLabel(PASSPORT_OPTIONS, input.passportStatus)?.toLowerCase()}.`;
}

// ── Paket yang cocok ──
export type MatchablePackage = {
  id: number; name: string; departureDate?: string | Date | null; isActive?: boolean;
  price?: unknown; priceQuad?: unknown; priceTriple?: unknown; priceDouble?: unknown; quotaRemaining?: number | null;
};
/** Harga termurah per orang (tipe kamar dewasa) dari katalog paket. */
export function packageFromPrice(pkg: MatchablePackage) {
  const prices = [pkg.priceQuad, pkg.priceTriple, pkg.priceDouble, pkg.price].map(parseRupiah).filter((v) => v > 0);
  return prices.length ? Math.min(...prices) : 0;
}
/** Paket aktif yang berangkat di bulan target, dalam budget per orang, dan kuotanya cukup. */
export function matchPackages(packages: MatchablePackage[], p: Pax & { targetMonth?: string | null; budgetRange?: string | null }, limit = 3) {
  const key = parseTargetMonth(p.targetMonth).key;
  if (!key) return [];
  const max = BUDGET_OPTIONS.find((b) => b.value === p.budgetRange)?.max ?? Number.POSITIVE_INFINITY;
  const adults = adultPaxOf(p);
  return packages
    .filter((pkg) => pkg.isActive !== false && pkg.departureDate && new Date(pkg.departureDate).toISOString().slice(0, 7) === key)
    .map((pkg) => ({ pkg, fromPrice: packageFromPrice(pkg) }))
    .filter(({ pkg, fromPrice }) => fromPrice <= max && (pkg.quotaRemaining == null || pkg.quotaRemaining >= Math.max(1, adults)))
    .sort((a, b) => a.fromPrice - b.fromPrice)
    .slice(0, limit);
}

/**
 * Penawaran terkirim tetapi jamaah/paket sudah berubah: nilai penawaran berbeda dengan hitungan katalog
 * saat ini, sehingga penawaran perlu dikirim ulang sebelum invoice.
 */
export function offerOutdated(p: Pax & { status: string; offerSentAt?: string | Date | null; dealValue?: unknown }, pkg?: Parameters<typeof packageBookingValue>[0] | null) {
  if (!p.offerSentAt || !pkg || isWonStatus(p.status) || isLostStatus(p.status)) return false;
  const offered = Number(p.dealValue) || 0;
  return offered > 0 && packageBookingValue(pkg, p) !== offered;
}

// ── Kecocokan paket terpilih dengan kualifikasi (tab Paket) ──
/** Paket sudah berangkat (tanggal berangkat sebelum hari ini, WIB). */
export function isPackageDeparted(pkg: { departureDate?: string | Date | null }, now = new Date()) {
  if (!pkg.departureDate) return false;
  const today = new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  return new Date(pkg.departureDate).toISOString().slice(0, 10) < today;
}

/**
 * Cocok/tidak per kriteria; `null` = tidak bisa dinilai (data kualifikasi/paket belum ada).
 * Bulan dibandingkan dengan bulan target, harga mulai per orang dengan budget, sisa kuota dengan jumlah dewasa.
 */
export function packageFit(pkg: MatchablePackage, p: Pax & { targetMonth?: string | null; budgetRange?: string | null }) {
  const key = parseTargetMonth(p.targetMonth).key;
  const departureKey = pkg.departureDate ? new Date(pkg.departureDate).toISOString().slice(0, 7) : null;
  const budget = BUDGET_OPTIONS.find((b) => b.value === p.budgetRange);
  const fromPrice = packageFromPrice(pkg);
  return {
    month: key && departureKey ? departureKey === key : null,
    budget: budget && fromPrice ? fromPrice <= budget.max : null,
    quota: pkg.quotaRemaining == null ? null : pkg.quotaRemaining >= Math.max(1, adultPaxOf(p)),
  };
}

/** "2 Quad + 1 Double + 1 bayi" untuk kalimat estimasi. */
export function paxSummary(p: Pax) {
  const parts = [
    [p.paxQuad, 'Quad'], [p.paxTriple, 'Triple'], [p.paxDouble, 'Double'], [p.paxInfant, 'bayi'],
  ].filter(([count]) => Number(count) > 0).map(([count, name]) => `${count} ${name}`);
  return parts.join(' + ');
}
