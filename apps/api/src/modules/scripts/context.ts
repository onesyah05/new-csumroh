import crypto from 'node:crypto';
import {
  BUDGET_OPTIONS, businessDateKey, dateOnlyKey, formatCatalogRupiah, formatRupiah, isLostStatus, isPackageDeparted,
  isWonStatus, optionLabel, packageFromPrice, parseRupiahStrict, parseTargetMonth, targetMonthLabel,
} from '@csumroh/shared-types';

/**
 * Konteks pustaka script (audit S01–S03, S05, S07, S12, S15). Satu token = satu arti dan satu sumber data.
 * Nilai yang tidak diketahui TIDAK diganti prosa rekaan: token dibiarkan, lalu dilaporkan sebagai data yang kurang
 * beserta cara melengkapinya. Fakta paket/transaksi hanya dari data server, bukan dari isian client.
 */
type Brand = { name: string; ppiuNumber: string | null; bankName: string | null; bankAccountNumber: string | null; bankAccountHolder: string | null };
type Pkg = {
  id: number; name: string; isActive: boolean; departureDate: Date | null; departureInfo: string | null; duration: string | null;
  airline: string | null; hotelMakkah: string | null; hotelMadinah: string | null; price: string; dp: string;
  priceQuad: string | null; priceTriple: string | null; priceDouble: string | null; priceInfant: string | null;
  quotaRemaining: number | null; facilitiesIncluded: string | null; facilitiesExcluded: string | null;
  isPromo: boolean; promoDiscount: string | null; promoDeadline: Date | null;
};
type Prospect = {
  status: string; name: string; city: string | null; targetMonth: string | null; budgetRange: string | null;
  paxQuad: number; paxTriple: number; paxDouble: number; paxInfant: number; nextFollowupDate: Date | null;
  offerSentAt: Date | null; dealValue: unknown; invoiceNumber: string | null; invoiceAmount: unknown; invoiceDueAt: Date | null;
  paymentProofUrl: string | null;
};

export type TokenKind = 'fact' | 'context';
/** Label untuk CS dan cara melengkapinya. `fact` = hanya dari data (tidak boleh diketik CS); `context` = isian profil. */
export const TOKEN_INFO: Record<string, { label: string; kind: TokenKind; fix: string }> = {
  paket: { label: 'paket', kind: 'fact', fix: 'Pilih paket aktif di tab Paket' },
  tanggal_keberangkatan: { label: 'tanggal keberangkatan', kind: 'fact', fix: 'Pilih paket yang jadwalnya terisi' },
  durasi: { label: 'durasi paket', kind: 'fact', fix: 'Lengkapi durasi paket di katalog' },
  maskapai: { label: 'maskapai', kind: 'fact', fix: 'Lengkapi maskapai paket di katalog' },
  hotel: { label: 'hotel', kind: 'fact', fix: 'Lengkapi hotel paket di katalog' },
  harga_mulai: { label: 'harga paket', kind: 'fact', fix: 'Pilih paket dengan harga yang terbaca' },
  harga_kamar: { label: 'harga per tipe kamar', kind: 'fact', fix: 'Pilih paket dengan harga yang terbaca' },
  dp_per_orang: { label: 'DP per orang', kind: 'fact', fix: 'Lengkapi DP paket di katalog' },
  fasilitas_termasuk: { label: 'fasilitas yang termasuk', kind: 'fact', fix: 'Lengkapi fasilitas paket di katalog' },
  fasilitas_tidak_termasuk: { label: 'biaya yang belum termasuk', kind: 'fact', fix: 'Lengkapi pengecualian paket di katalog' },
  kuota_paket: { label: 'sisa kuota paket', kind: 'fact', fix: 'Kuota paket habis atau belum diisi' },
  promo: { label: 'promo', kind: 'fact', fix: 'Tidak ada promo yang masih berlaku' },
  batas_promo: { label: 'batas promo', kind: 'fact', fix: 'Tidak ada promo yang masih berlaku' },
  nilai_penawaran: { label: 'nilai penawaran', kind: 'fact', fix: 'Kirim penawaran resmi dulu' },
  nominal_pembayaran_awal: { label: 'nominal invoice', kind: 'fact', fix: 'Kirim invoice pembayaran awal dulu' },
  nomor_invoice: { label: 'nomor invoice', kind: 'fact', fix: 'Kirim invoice pembayaran awal dulu' },
  batas_pembayaran: { label: 'batas pembayaran', kind: 'fact', fix: 'Kirim invoice pembayaran awal dulu' },
  ppiu: { label: 'nomor PPIU', kind: 'fact', fix: 'Admin perlu melengkapi nomor PPIU brand' },
  bank: { label: 'bank', kind: 'fact', fix: 'Admin perlu melengkapi rekening brand' },
  rekening: { label: 'nomor rekening', kind: 'fact', fix: 'Admin perlu melengkapi rekening brand' },
  nama_rekening: { label: 'nama pemilik rekening', kind: 'fact', fix: 'Admin perlu melengkapi rekening brand' },
  jumlah_jamaah: { label: 'jumlah jamaah', kind: 'context', fix: 'Isi jumlah jamaah di tab Kualifikasi' },
  bulan_target: { label: 'bulan keberangkatan', kind: 'context', fix: 'Isi bulan keberangkatan di tab Kualifikasi' },
  budget: { label: 'budget', kind: 'context', fix: 'Isi budget di tab Kualifikasi' },
  tanggal_followup: { label: 'tanggal follow-up', kind: 'context', fix: 'Isi tanggal follow-up di tab Catatan' },
  kota: { label: 'kota', kind: 'context', fix: 'Isi kota di halaman detail prospek' },
};

const dateLong = (value: Date) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(value);
const dateTimeWib = (value: Date) =>
  `${new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(value)} WIB`;
const bullets = (text: string | null, limit = 8) => {
  const items = String(text ?? '').split('\n').map((line) => line.replace(/^[-•*\s]+/, '').trim()).filter(Boolean);
  if (!items.length) return null;
  const shown = items.slice(0, limit).map((item) => `• ${item}`);
  if (items.length > limit) shown.push(`• dan ${items.length - limit} lainnya (lihat brosur)`);
  return shown.join('\n');
};
const clean = (value: string | null | undefined) => (value && value.trim() && value.trim() !== '-' ? value.trim() : null);

export function buildScriptContext(input: { csName: string; brand: Brand; pkg: Pkg | null; prospect: Prospect | null; now?: Date }) {
  const { brand, pkg, prospect } = input;
  const now = input.now ?? new Date();
  const today = businessDateKey(now);
  const warnings: string[] = [];
  const v: Record<string, string | null> = {};

  v.travel = brand.name;
  v.cs_name = input.csName;
  v.ppiu = clean(brand.ppiuNumber);
  v.bank = clean(brand.bankName);
  v.rekening = clean(brand.bankAccountNumber);
  v.nama_rekening = clean(brand.bankAccountHolder);

  // Paket: hanya fakta dari paket aktif yang belum berangkat.
  const pkgUsable = Boolean(pkg && pkg.isActive && !isPackageDeparted(pkg, now));
  if (pkg && !pkgUsable) warnings.push(pkg.isActive ? 'Paket terpilih sudah berangkat; pilih paket lain.' : 'Paket terpilih nonaktif di katalog; pilih paket lain.');
  if (pkg && pkgUsable) {
    v.paket = pkg.name;
    v.tanggal_keberangkatan = pkg.departureDate ? dateLong(pkg.departureDate) : clean(pkg.departureInfo);
    v.durasi = clean(pkg.duration);
    v.maskapai = clean(pkg.airline);
    v.hotel = [clean(pkg.hotelMakkah) && `${pkg.hotelMakkah} (Makkah)`, clean(pkg.hotelMadinah) && `${pkg.hotelMadinah} (Madinah)`].filter(Boolean).join(', ') || null;
    const from = packageFromPrice(pkg);
    v.harga_mulai = from ? formatRupiah(from) : null;
    const rooms = ([['Quad', pkg.priceQuad || pkg.price], ['Triple', pkg.priceTriple], ['Double', pkg.priceDouble], ['Bayi', pkg.priceInfant]] as const)
      .map(([label, price]) => [label, formatCatalogRupiah(price)] as const)
      .filter(([, price]) => price)
      .map(([label, price]) => `• ${label}: ${price} per orang`);
    v.harga_kamar = rooms.length ? rooms.join('\n') : null;
    v.dp_per_orang = formatCatalogRupiah(pkg.dp);
    v.fasilitas_termasuk = bullets(pkg.facilitiesIncluded);
    v.fasilitas_tidak_termasuk = bullets(pkg.facilitiesExcluded);
    if (pkg.quotaRemaining != null && pkg.quotaRemaining > 0) v.kuota_paket = `${pkg.quotaRemaining} orang`;
    else if (pkg.quotaRemaining === 0) warnings.push('Kuota paket habis; jangan mengajak mendaftar di paket ini.');
    // Promo hanya bila jelas masih berlaku (ada batas waktu yang belum lewat).
    const promoDeadline = dateOnlyKey(pkg.promoDeadline);
    if (pkg.isPromo && clean(pkg.promoDiscount) && promoDeadline && promoDeadline >= today) {
      v.promo = clean(pkg.promoDiscount);
      v.batas_promo = dateLong(pkg.promoDeadline!);
    } else if (pkg.isPromo && promoDeadline && promoDeadline < today) {
      warnings.push('Promo paket sudah berakhir.');
    }
  }

  if (prospect) {
    const adults = prospect.paxQuad + prospect.paxTriple + prospect.paxDouble;
    const total = adults + prospect.paxInfant;
    v.jumlah_jamaah = adults > 0 ? String(total) : null;
    v.bulan_target = targetMonthLabel(prospect.targetMonth) ?? null;
    v.budget = prospect.budgetRange ? `${optionLabel(BUDGET_OPTIONS, prospect.budgetRange)} per orang` : null;
    v.kota = clean(prospect.city);
    const followup = dateOnlyKey(prospect.nextFollowupDate);
    v.tanggal_followup = followup ? dateLong(new Date(`${followup}T00:00:00.000Z`)) : null;
    if (prospect.offerSentAt && Number(prospect.dealValue) > 0) v.nilai_penawaran = formatRupiah(Number(prospect.dealValue));
    // Instruksi transfer hanya dari invoice pembayaran awal yang berlaku (bukan DP katalog × tebakan).
    const invoiceAmount = parseRupiahStrict(prospect.invoiceAmount);
    if (prospect.status === 'closing' && prospect.invoiceNumber && invoiceAmount && invoiceAmount > 0) {
      v.nomor_invoice = prospect.invoiceNumber;
      v.nominal_pembayaran_awal = formatRupiah(invoiceAmount);
      v.batas_pembayaran = prospect.invoiceDueAt ? dateTimeWib(prospect.invoiceDueAt) : null;
    }
    // Target bulan prospek dan bulan keberangkatan paket adalah dua data berbeda; ketidakcocokan ditunjukkan.
    const target = parseTargetMonth(prospect.targetMonth).key;
    const departureMonth = pkg && pkgUsable && pkg.departureDate ? pkg.departureDate.toISOString().slice(0, 7) : null;
    if (target && departureMonth && target !== departureMonth) {
      warnings.push(`Paket berangkat ${v.tanggal_keberangkatan}, sedangkan target prospek ${v.bulan_target}.`);
    }
    if (pkg && pkgUsable && pkg.quotaRemaining != null && adults > pkg.quotaRemaining) {
      warnings.push(`Sisa kuota paket (${pkg.quotaRemaining}) kurang dari jumlah jamaah dewasa (${adults}).`);
    }
  }

  const variables = Object.fromEntries(Object.entries(v).filter(([, value]) => value)) as Record<string, string>;
  const version = crypto.createHash('sha1').update(JSON.stringify(variables)).digest('hex').slice(0, 10);
  const state = {
    won: prospect ? isWonStatus(prospect.status) : false,
    lost: prospect ? isLostStatus(prospect.status) : false,
    proofSubmitted: Boolean(prospect?.paymentProofUrl),
  };
  return { variables, warnings, version, state };
}

export type ScriptContext = ReturnType<typeof buildScriptContext>;

const TOKEN = /\{\{([a-z0-9_]+)\}\}/gi;
export function unresolvedTokens(texts: string[]) {
  const found = new Set<string>();
  for (const text of texts) for (const match of text.matchAll(TOKEN)) found.add(match[1]!.toLowerCase());
  return [...found];
}

export type ScriptStatus = 'ready' | 'needs_context' | 'blocked';
const AUDIENCE_LABEL: Record<string, string> = {
  keluarga: 'Khusus bila berangkat bersama keluarga',
  pasangan: 'Khusus bila berangkat bersama pasangan',
  orang_tua: 'Khusus bila memberangkatkan orang tua',
  rombongan: 'Khusus rombongan',
  lead_form: 'Khusus kontak dari formulir website',
  jaringan_pribadi: 'Khusus kenalan pribadi CS',
};

/**
 * Status pakai script: `blocked` bila fakta wajib tidak ada (tidak boleh diketik CS), `needs_context` bila isian
 * profil kurang atau script khusus konteks tertentu, `ready` bila semua data tersedia.
 */
const describeMissing = (texts: string[]) =>
  unresolvedTokens(texts).map((token) => ({ token, ...(TOKEN_INFO[token] ?? { label: token, kind: 'fact' as TokenKind, fix: 'Data belum tersedia' }) }));

export function annotateScript(script: any, ctx: ScriptContext) {
  // TGJP: status script dari teks yang pasti dikirim; tiap variasi Jawab dinilai sendiri agar satu cabang yang
  // datanya kurang tidak memblokir seluruh penanganan keberatan.
  const steps = Array.isArray(script.steps)
    ? script.steps.map((step: any) => ({
      ...step,
      variants: (step.variants ?? []).map((variant: any) => {
        const gaps = describeMissing([variant.text ?? '']);
        return { ...variant, missing: gaps.map(({ token, label, kind }) => ({ token, label, kind })), blocked: gaps.some((item) => item.kind === 'fact') };
      }),
    }))
    : undefined;
  const texts = steps ? steps.filter((step: any) => step.choose !== 'reason').map((step: any) => step.text ?? '') : [script.script ?? ''];
  const missing = describeMissing(texts);
  const reasons: string[] = [];
  let status: ScriptStatus = 'ready';
  const facts = missing.filter((item) => item.kind === 'fact');
  if (facts.length) {
    status = 'blocked';
    reasons.push(...new Set(facts.map((item) => item.fix)));
  }
  if (script.when === 'proof_submitted' && !ctx.state.proofSubmitted) {
    status = 'blocked';
    reasons.push('Belum ada bukti transfer');
  }
  if (status !== 'blocked') {
    const context = missing.filter((item) => item.kind === 'context');
    if (context.length) {
      status = 'needs_context';
      reasons.push(...new Set(context.map((item) => item.fix)));
    }
    if (script.audience && script.audience !== 'umum') {
      status = 'needs_context';
      reasons.push(AUDIENCE_LABEL[script.audience] ?? 'Perlu konfirmasi konteks');
    }
  }
  return { ...script, ...(steps ? { steps } : {}), status, reasons, missing: missing.map(({ token, label, kind }) => ({ token, label, kind })) };
}
