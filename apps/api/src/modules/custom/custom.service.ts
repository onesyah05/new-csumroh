import type { Prisma } from '@prisma/client';
import {
  BUDGET_OPTIONS, CUSTOM_DEFAULT_VALIDITY_DAYS, CUSTOM_ROUTES, customDisplayStatus, customMinDpTotal, customRoomsFor, customTotalNights, formatRupiah,
  paxSummary, samePax,
} from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../utils/http.js';

type Db = Prisma.TransactionClient | typeof prisma;
type CustomRow = NonNullable<Awaited<ReturnType<typeof prisma.customRequest.findFirst>>>;

/** Permintaan custom yang masih berjalan untuk prospek (paling baru, bukan dibatalkan). */
export function activeCustomFor(prospectId: number, db: Db = prisma) {
  return db.customRequest.findFirst({ where: { prospectId, status: { not: 'cancelled' } }, orderBy: { id: 'desc' } });
}

const num = (value: unknown) => Number(value ?? 0);

/**
 * Syarat sebelum penawaran/invoice/verifikasi custom: harga sudah disepakati dan komposisi jamaah prospek masih sama
 * dengan yang dihitung Tim LA. Mengembalikan angka yang dipakai alur transaksi.
 */
export function assertAgreedCustom(custom: CustomRow, prospect: { paxQuad: number; paxTriple: number; paxDouble: number; paxInfant: number }) {
  if (custom.status !== 'agreed' || !custom.agreedPrice) {
    throw new HttpError(409, 'Layanan custom: sepakati harga dengan jamaah dulu (isi nilai deal akhir).');
  }
  if (!samePax(custom, prospect)) {
    throw new HttpError(409, 'Jumlah jamaah berubah setelah dihitung Tim LA. Minta hitung ulang lewat Layanan Custom.');
  }
  return {
    agreedPrice: num(custom.agreedPrice),
    minDpTotal: customMinDpTotal(custom),
    basePackageId: custom.basePackageId,
  };
}

/**
 * Isian Kualifikasi dari layanan custom (hanya yang masih kosong): bulan keberangkatan dari tanggal berangkat,
 * budget dari budget per orang (pilihan terdekat ke atas). CS tidak mengetik ulang data yang sama.
 */
export function qualificationFromCustom(custom: { departureDate: Date | null; budgetPerPax: unknown }, prospect: { targetMonth: string | null; budgetRange: string | null }) {
  const data: { targetMonth?: string; budgetRange?: string } = {};
  if (!prospect.targetMonth && custom.departureDate) data.targetMonth = custom.departureDate.toISOString().slice(0, 7);
  const budget = Number(custom.budgetPerPax ?? 0);
  if (!prospect.budgetRange && budget > 0) {
    const option = BUDGET_OPTIONS.find((item) => budget <= item.max);
    if (option) data.budgetRange = option.value;
  }
  return data;
}

/** Akhir hari (23.59.59 WIB) dari tanggal YYYY-MM-DD, atau 3 hari dari sekarang. */
export function quoteValidUntil(date: string | null, now = new Date()) {
  if (date) {
    const end = new Date(`${date}T23:59:59.000+07:00`);
    if (Number.isNaN(end.getTime())) throw new HttpError(422, 'Tanggal berlaku tidak valid.');
    if (end.getTime() < now.getTime()) throw new HttpError(422, 'Tanggal berlaku harga sudah lewat.');
    return end;
  }
  return new Date(now.getTime() + CUSTOM_DEFAULT_VALIDITY_DAYS * 86_400_000);
}

export function isExpired(custom: { status: string; quoteValidUntil: Date | null }, now = new Date()) {
  return customDisplayStatus(custom, now) === 'expired';
}

const yesNo = (value: boolean | null | undefined) => (value === true ? 'ya' : value === false ? 'tidak' : null);
const dateLong = (value: Date) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(value);

/** Ringkasan kebutuhan untuk log riwayat prospek (baris-baris singkat). */
export async function describeCustom(custom: CustomRow, db: Db = prisma) {
  if (custom.mode === 'package') {
    const pkg = custom.basePackageId ? await db.package.findUnique({ where: { id: custom.basePackageId }, select: { name: true } }) : null;
    const extras = Array.isArray(custom.extraHotels) ? (custom.extraHotels as any[]) : [];
    const removed = Array.isArray(custom.servicesRemoved) ? (custom.servicesRemoved as string[]) : [];
    const added = Array.isArray(custom.servicesAdded) ? (custom.servicesAdded as string[]) : [];
    return [
      `Berbasis paket: ${pkg?.name ?? '–'}${custom.departureDate ? ` (berangkat ${dateLong(custom.departureDate)})` : ''}`,
      `Jamaah: ${paxSummary(custom)}`,
      custom.extendNightsMakkah ? `Extend Makkah: +${custom.extendNightsMakkah} malam` : null,
      custom.extendNightsMadinah ? `Extend Madinah: +${custom.extendNightsMadinah} malam` : null,
      custom.hotelMakkah ? `Ganti hotel Makkah: ${custom.hotelMakkah}` : null,
      custom.hotelMadinah ? `Ganti hotel Madinah: ${custom.hotelMadinah}` : null,
      ...extras.map((row) => `Tambah ${row.country}: ${row.hotel || 'hotel bebas'}, ${row.nights} malam`),
      removed.length ? `Layanan dikurangi: ${removed.join(', ')}` : null,
      added.length ? `Layanan ditambah: ${added.join(', ')}` : null,
      custom.cityTour ? `City tour tambahan: ${custom.cityTour}` : null,
      custom.budgetPerPax ? `Budget: ${formatRupiah(num(custom.budgetPerPax))} per orang` : null,
    ].filter(Boolean).join('\n');
  }
  const extras = Array.isArray(custom.extraHotels) ? (custom.extraHotels as any[]) : [];
  const services = [
    yesNo(custom.fastTrain) && `kereta cepat ${yesNo(custom.fastTrain)}`,
    yesNo(custom.equipment) && `perlengkapan ${yesNo(custom.equipment)}`,
    yesNo(custom.tourLeader) && `TL ${yesNo(custom.tourLeader)}`,
    yesNo(custom.muthawif) && `muthowif ${yesNo(custom.muthawif)}`,
  ].filter(Boolean);
  return [
    `Berangkat: ${[custom.departureDate ? dateLong(custom.departureDate) : null, custom.departureDateTo ? `s.d. ${dateLong(custom.departureDateTo)}` : null].filter(Boolean).join(' ')}${custom.departureCity ? ` dari ${custom.departureCity}` : ''}`,
    `Jamaah: ${paxSummary(custom)}`,
    custom.airline || custom.flightType ? `Pesawat: ${[custom.airline, custom.flightType === 'direct' ? 'Direct' : custom.flightType === 'transit' ? 'Transit' : null].filter(Boolean).join(' · ')}` : null,
    custom.hotelMakkah || custom.nightsMakkah ? `Makkah: ${custom.hotelMakkah ?? 'hotel bebas'}${custom.nightsMakkah ? `, ${custom.nightsMakkah} malam` : ''}` : null,
    custom.hotelMadinah || custom.nightsMadinah ? `Madinah: ${custom.hotelMadinah ?? 'hotel bebas'}${custom.nightsMadinah ? `, ${custom.nightsMadinah} malam` : ''}` : null,
    ...extras.map((row) => `${row.country}: ${row.hotel || 'hotel bebas'}, ${row.nights} malam`),
    customTotalNights(custom) ? `Total ${customTotalNights(custom)} malam` : null,
    custom.route ? `Rute: ${CUSTOM_ROUTES.find((r) => r.value === custom.route)?.label ?? custom.route}` : null,
    services.length ? `Layanan: ${services.join(', ')}` : null,
    custom.cityTour ? `City tour tambahan: ${custom.cityTour}` : null,
    custom.budgetPerPax ? `Budget: ${formatRupiah(num(custom.budgetPerPax))} per orang` : null,
  ].filter(Boolean).join('\n');
}

export function describeQuote(custom: Pick<CustomRow, 'offeredPrice' | 'floorPrice' | 'offeredPrices' | 'floorPrices' | 'minDpPerPax' | 'minDpInfant' | 'quoteValidUntil' | 'paxQuad' | 'paxTriple' | 'paxDouble' | 'paxInfant'>) {
  const offered = (custom.offeredPrices ?? {}) as Record<string, number>;
  const floor = (custom.floorPrices ?? {}) as Record<string, number>;
  return [
    ...customRoomsFor(custom).map((room) => `${room.label} ${room.pax} × ${formatRupiah(num(offered[room.key]))} (terendah ${formatRupiah(num(floor[room.key]))})`),
    `Harga ditawarkan: ${formatRupiah(num(custom.offeredPrice))}`,
    `Harga terendah: ${formatRupiah(num(custom.floorPrice))}`,
    `DP minimal: ${formatRupiah(num(custom.minDpPerPax))} per dewasa${custom.paxInfant ? `, ${formatRupiah(num(custom.minDpInfant ?? custom.minDpPerPax))} per bayi` : ''} (total ${formatRupiah(customMinDpTotal(custom))})`,
    custom.quoteValidUntil ? `Berlaku sampai: ${new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(custom.quoteValidUntil)} WIB` : null,
  ].filter(Boolean).join('\n');
}
