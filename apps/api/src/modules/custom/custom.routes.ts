import { Router, type Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  customAgreeSchema, customQuoteSchema, customRequestInputSchema, customReturnSchema, customRevisionSchema, customRoomTotal, customRoomsFor, formatRupiah,
  isLostStatus, isQualificationComplete, isWonStatus, samePax, type CustomRequestInput, type CustomRoomPrices,
} from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { authGuard, requireRole, scopedBrandId } from '../../middleware/auth.js';
import { emitToBrand } from '../../realtime/socket.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { dispatch, notifyCustomAgreed, notifyCustomQuoted, notifyCustomReturned, notifyCustomSubmitted, notifyCustomUpdated } from '../notifications/notification.events.js';
import { assertCanActOnProspect } from '../prospects/pic.js';
import { queueCapiForStatus } from '../capi/capi.service.js';
import { activeCustomFor, describeCustom, describeQuote, isExpired, qualificationFromCustom, quoteValidUntil } from './custom.service.js';

/**
 * Layanan Custom. CS (PIC) mencatat kebutuhan → Tim LA (semua brand) menghitung harga → CS menyepakati nilai deal
 * akhir (tidak boleh di bawah harga terendah) → penawaran, invoice, dan verifikasi memakai alur prospek biasa.
 */
export const customRouter = Router();
customRouter.use(authGuard);

const PRICING_ROLES = ['product', 'superadmin'] as const;
const HOLDING_READERS = ['product', 'superadmin', 'admin', 'finance'];

const detailInclude = {
  prospect: {
    select: {
      id: true, name: true, phone: true, status: true, userId: true, brandId: true, offerSentAt: true, invoiceSentAt: true, invoiceNumber: true,
      user: { select: { name: true } },
    },
  },
  brand: { select: { id: true, name: true, code: true, logoUrl: true } },
  basePackage: {
    select: {
      id: true, name: true, departureDate: true, departureInfo: true, duration: true, airline: true, flightType: true,
      hotelMakkah: true, hotelMadinah: true, quotaRemaining: true, facilitiesIncluded: true, facilitiesExcluded: true, itinerary: true,
    },
  },
  createdBy: { select: { name: true } },
  quotedBy: { select: { name: true } },
  claimedBy: { select: { id: true, name: true } },
} satisfies Prisma.CustomRequestInclude;

function allowedBrands(req: Request) {
  const user = req.user!;
  if (HOLDING_READERS.includes(user.role)) return null;
  const ids = new Set<number>();
  if (user.brandId) ids.add(user.brandId);
  for (const ub of user.userBrands ?? []) if (ub.brand?.id) ids.add(ub.brand.id);
  return [...ids];
}

async function loadRequest(req: Request) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'ID permintaan tidak valid.');
  const row = await prisma.customRequest.findUnique({ where: { id }, include: detailInclude });
  if (!row) throw new HttpError(404, 'Permintaan layanan custom tidak ditemukan.');
  const brands = allowedBrands(req);
  if (brands && !brands.includes(row.brandId)) throw new HttpError(404, 'Permintaan layanan custom tidak ditemukan.');
  return row;
}

async function loadProspect(req: Request, id: number) {
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'ID prospek tidak valid.');
  const row = await prisma.prospect.findFirst({ where: { id } });
  if (!row) throw new HttpError(404, 'Prospek tidak ditemukan.');
  scopedBrandId(req, row.brandId);
  return row;
}

/** Hanya PIC/Admin prospek; Tim LA dan Finance tidak mengubah kebutuhan jamaah. */
async function assertCsCanEdit(req: Request, prospect: { userId: number | null; status: string }) {
  if (!['cs', 'admin', 'superadmin'].includes(req.user!.role)) throw new HttpError(403, 'Hanya CS (PIC) atau Admin yang mengelola kebutuhan jamaah.');
  await assertCanActOnProspect(req.user!, prospect);
  if (isWonStatus(prospect.status)) throw new HttpError(409, 'Prospek sudah Deal; layanan custom tidak dapat diubah.');
  if (isLostStatus(prospect.status)) throw new HttpError(409, 'Prospek sudah batal. Aktifkan kembali prospek sebelum membuat layanan custom.');
}

type BasePackage = { id: number; departureDate: Date | null } | null;

/**
 * Berbasis paket: tanggal berangkat & pesawat mengikuti paket (tidak diisi CS), yang disimpan hanya perubahannya
 * (extend malam, ganti hotel, layanan, negara tambahan). Full custom: isian extend tidak dipakai.
 */
function toData(input: CustomRequestInput, pkg: BasePackage) {
  const packageMode = input.mode === 'package';
  return {
    ...input,
    departureDate: packageMode ? pkg?.departureDate ?? null
      : input.departureDate ? new Date(`${input.departureDate}T00:00:00.000Z`) : null,
    departureDateTo: !packageMode && input.departureDateTo ? new Date(`${input.departureDateTo}T00:00:00.000Z`) : null,
    // Berbasis paket: layanan dicatat sebagai dikurangi/ditambah dari isi paket; full custom memakai pilihan ya/tidak.
    ...(packageMode
      ? {
        departureNote: null, departureCity: null, airline: null, flightType: null, nightsMakkah: null, nightsMadinah: null, route: null,
        equipment: null, fastTrain: null, tourLeader: null, muthawif: null,
        servicesRemoved: input.servicesRemoved as unknown as Prisma.InputJsonValue,
        servicesAdded: input.servicesAdded as unknown as Prisma.InputJsonValue,
      }
      : { departureNote: null, extendNightsMakkah: null, extendNightsMadinah: null, servicesRemoved: Prisma.DbNull, servicesAdded: Prisma.DbNull }),
    extraHotels: input.extraHotels as unknown as Prisma.InputJsonValue,
    basePackageId: input.basePackageId ?? null,
  };
}

async function loadBasePackage(brandId: number, packageId?: number | null): Promise<BasePackage> {
  if (!packageId) return null;
  const pkg = await prisma.package.findFirst({ where: { id: packageId, brandId }, select: { id: true, departureDate: true } });
  if (!pkg) throw new HttpError(404, 'Paket dasar tidak ditemukan di brand ini.');
  return pkg;
}

const pax = (input: { paxQuad: number; paxTriple: number; paxDouble: number; paxInfant: number }) =>
  ({ paxQuad: input.paxQuad, paxTriple: input.paxTriple, paxDouble: input.paxDouble, paxInfant: input.paxInfant });

type ProspectRow = NonNullable<Awaited<ReturnType<typeof prisma.prospect.findFirst>>>;

/** Jamaah prospek = jamaah permintaan custom; bulan & budget mengisi Kualifikasi bila kosong, lalu naik ke Terkualifikasi bila lengkap. */
async function syncProspect(tx: Prisma.TransactionClient, userId: number, prospect: ProspectRow, input: CustomRequestInput, row: { departureDate: Date | null; budgetPerPax: unknown }) {
  const qualification = qualificationFromCustom(row, prospect);
  const merged = { ...prospect, ...pax(input), ...qualification };
  const promote = isQualificationComplete(merged) && ['new', 'contact', 'identifying'].includes(prospect.status);
  await tx.prospect.update({ where: { id: prospect.id }, data: { ...pax(input), ...qualification, ...(promote ? { status: 'qualified' } : {}) } });
  if (promote) queueCapiForStatus(prospect.id, 'qualified');
  if (Object.keys(qualification).length || promote) {
    await tx.prospectLog.create({
      data: {
        prospectId: prospect.id, userId, actionType: promote ? 'status_changed' : 'profile_updated',
        title: promote ? 'Status otomatis menjadi Terkualifikasi' : 'Kualifikasi diisi dari layanan custom',
        description: [qualification.targetMonth && `Bulan keberangkatan: ${qualification.targetMonth}`, qualification.budgetRange && `Budget: ${qualification.budgetRange}`].filter(Boolean).join('\n') || null,
      },
    });
  }
}

// ───────────── Daftar & detail ─────────────
customRouter.get('/', asyncHandler(async (req, res) => {
  const group = z.enum(['pending', 'returned', 'quoted', 'agreed', 'cancelled', 'all']).default('pending').parse(req.query.group ?? undefined);
  const brands = allowedBrands(req);
  const statusFilter: Prisma.CustomRequestWhereInput = group === 'pending'
    ? { status: { in: ['submitted', 'revision_requested'] } }
    : group === 'returned' ? { status: 'needs_info' }
    : group === 'all' ? {} : { status: group };
  const rows = await prisma.customRequest.findMany({
    where: { ...statusFilter, ...(brands ? { brandId: { in: brands } } : {}) },
    include: detailInclude,
    // Antrean hitung: yang paling lama masuk antrean di atas, lalu yang berangkat paling dekat.
    orderBy: group === 'pending' ? [{ queuedAt: 'asc' }, { departureDate: 'asc' }] : [{ updatedAt: 'desc' }],
    take: 200,
  });
  const counts = await prisma.customRequest.groupBy({
    by: ['status'], _count: { _all: true }, where: brands ? { brandId: { in: brands } } : {},
  });
  res.json({ success: true, data: { rows, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) } });
}));

customRouter.get('/prospect/:prospectId', asyncHandler(async (req, res) => {
  const prospect = await loadProspect(req, Number(req.params.prospectId));
  const active = await activeCustomFor(prospect.id);
  const data = active ? await prisma.customRequest.findUnique({ where: { id: active.id }, include: detailInclude }) : null;
  res.json({ success: true, data });
}));

customRouter.get('/:id', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await loadRequest(req) });
}));

// ───────────── CS: catat kebutuhan ─────────────
customRouter.post('/prospect/:prospectId', asyncHandler(async (req, res) => {
  const prospect = await loadProspect(req, Number(req.params.prospectId));
  await assertCsCanEdit(req, prospect);
  if (await activeCustomFor(prospect.id)) throw new HttpError(409, 'Prospek ini sudah punya permintaan layanan custom yang berjalan.');
  const input = customRequestInputSchema.parse(req.body);
  const pkg = await loadBasePackage(prospect.brandId, input.basePackageId);

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.customRequest.create({
      data: { ...toData(input, pkg), brandId: prospect.brandId, prospectId: prospect.id, createdById: req.user!.id, status: 'submitted', queuedAt: new Date() },
    });
    // Satu sumber jumlah jamaah: prospek mengikuti komposisi yang dihitung Tim LA; bulan & budget mengisi Kualifikasi.
    await syncProspect(tx, req.user!.id, prospect, input, row);
    await tx.prospectLog.create({
      data: { prospectId: prospect.id, userId: req.user!.id, actionType: 'custom_submitted', title: 'Layanan custom dikirim ke Tim LA', description: await describeCustom(row, tx) },
    });
    return row;
  });
  emitToBrand(prospect.brandId, 'prospect:updated', { id: prospect.id });
  dispatch(() => notifyCustomSubmitted({ prospect, actor: req.user!, requestId: created.id }));
  res.status(201).json({ success: true, data: await prisma.customRequest.findUnique({ where: { id: created.id }, include: detailInclude }) });
}));

/**
 * Ubah kebutuhan jamaah (satu langkah untuk semua status):
 * - menunggu Tim LA: disimpan tanpa mengubah urutan antrean;
 * - dikembalikan ke CS: disimpan lalu otomatis dikirim ulang ke Tim LA;
 * - sudah dihitung/disepakati: disimpan lalu otomatis diminta hitung ulang; alasan = ringkasan perubahan.
 */
customRouter.patch('/:id', asyncHandler(async (req, res) => {
  const current = await loadRequest(req);
  const prospect = await loadProspect(req, current.prospectId);
  await assertCsCanEdit(req, prospect);
  if (current.status === 'cancelled') throw new HttpError(409, 'Permintaan sudah dibatalkan.');
  const priced = current.status === 'quoted' || current.status === 'agreed';
  if (priced && prospect.paymentProofUrl) throw new HttpError(409, 'Bukti transfer sudah diajukan; kebutuhan tidak dapat diubah.');
  const input = customRequestInputSchema.parse(req.body);
  const { revisionNote: extraNote, voidInvoice } = z.object({ revisionNote: z.string().trim().max(1000).optional(), voidInvoice: z.boolean().optional() }).parse(req.body ?? {});
  // Invoice yang sudah terkirim memakai harga lama: dibatalkan secara sadar sebelum kebutuhan boleh diubah.
  const invoiceOpen = Boolean(prospect.invoiceSentAt && Number(prospect.invoiceAmount) > 0);
  if (priced && invoiceOpen && !voidInvoice) {
    throw new HttpError(409, `Invoice ${prospect.invoiceNumber ?? ''} sudah terkirim. Konfirmasi pembatalan invoice untuk mengubah kebutuhan.`.replace('  ', ' '));
  }
  const pkg = await loadBasePackage(prospect.brandId, input.basePackageId);
  const before = await describeCustom(current);
  const resubmit = current.status === 'needs_info';
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.customRequest.update({ where: { id: current.id }, data: toData(input, pkg) });
    await syncProspect(tx, req.user!.id, prospect, input, row);
    const after = await describeCustom(row, tx);
    if (priced && invoiceOpen) {
      await tx.prospect.update({
        where: { id: prospect.id },
        data: { invoiceNumber: null, invoiceAmount: 0, invoiceSentAt: null, invoiceDueAt: null, invoiceMessageId: null, ...(prospect.status === 'closing' ? { status: 'offer' } : {}) },
      });
      await tx.prospectLog.create({
        data: {
          prospectId: prospect.id, userId: req.user!.id, actionType: 'invoice_voided', title: `Invoice ${prospect.invoiceNumber ?? ''} dibatalkan`.trim(),
          description: 'Kebutuhan layanan custom berubah; kirim invoice baru setelah harga baru disepakati.',
        },
      });
    }
    const changes = diffLines(before, after);
    if (priced || resubmit) {
      const note = [extraNote, changes.length ? `Perubahan:\n${changes.join('\n')}` : null].filter(Boolean).join('\n') || 'Kebutuhan jamaah diperbarui.';
      await tx.customRequest.update({
        where: { id: current.id },
        data: {
          status: priced || current.quoteCount > 0 ? 'revision_requested' : 'submitted', queuedAt: new Date(), returnNote: null, claimedById: null, claimedAt: null,
          ...(priced ? { revisionNote: note, agreedPrice: null, agreedAt: null } : {}),
        },
      });
      // Kesepakatan lama tidak berlaku lagi.
      if (current.status === 'agreed') await tx.prospect.update({ where: { id: prospect.id }, data: { dealValue: 0 } });
      await tx.prospectLog.create({
        data: {
          prospectId: prospect.id, userId: req.user!.id, actionType: priced ? 'custom_revision' : 'custom_resubmitted',
          title: priced ? 'Kebutuhan diubah, diminta hitung ulang ke Tim LA' : 'Kebutuhan dilengkapi, dikirim ulang ke Tim LA',
          description: [note, priced ? `Harga sebelumnya:\n${describeQuote(current)}` : null].filter(Boolean).join('\n'),
        },
      });
    } else {
      await tx.prospectLog.create({
        data: { prospectId: prospect.id, userId: req.user!.id, actionType: 'custom_updated', title: 'Kebutuhan layanan custom diperbarui', description: changes.join('\n') || after },
      });
    }
    return row;
  });
  emitToBrand(prospect.brandId, 'prospect:updated', { id: prospect.id });
  if (priced || resubmit) dispatch(() => notifyCustomSubmitted({ prospect, actor: req.user!, requestId: current.id, revision: priced || current.quoteCount > 0 }));
  // Sedang dihitung Tim LA: beri tahu bahwa datanya berubah.
  else dispatch(() => notifyCustomUpdated({ prospect, actor: req.user!, requestId: current.id }));
  res.json({ success: true, data: await prisma.customRequest.findUnique({ where: { id: updated.id }, include: detailInclude }) });
}));

/**
 * Ringkasan perubahan per label: "Hotel Madinah: Dar Al Taqwa → Pullman Zamzam". Label baru ditulis apa adanya,
 * label yang hilang ditandai "Dihapus:".
 */
function diffLines(before: string, after: string) {
  const parse = (text: string) => new Map(text.split('\n').filter(Boolean).map((line) => {
    const at = line.indexOf(': ');
    return at > 0 ? [line.slice(0, at), line.slice(at + 2)] as const : [line, ''] as const;
  }));
  const a = parse(before);
  const b = parse(after);
  const out: string[] = [];
  for (const [label, value] of b) {
    if (!a.has(label)) out.push(value ? `${label}: ${value}` : label);
    else if (a.get(label) !== value) out.push(`${label}: ${a.get(label) || '–'} → ${value || '–'}`);
  }
  for (const [label, value] of a) if (!b.has(label)) out.push(`Dihapus: ${value ? `${label}: ${value}` : label}`);
  return out;
}

/** Kebutuhan berubah, harga kedaluwarsa, atau jamaah minta opsi lain: kembali ke antrean Tim LA. */
customRouter.post('/:id/revision', asyncHandler(async (req, res) => {
  const current = await loadRequest(req);
  const prospect = await loadProspect(req, current.prospectId);
  await assertCsCanEdit(req, prospect);
  if (!['quoted', 'agreed'].includes(current.status)) throw new HttpError(409, 'Permintaan ini belum dihitung Tim LA.');
  if (prospect.paymentProofUrl) throw new HttpError(409, 'Bukti transfer sudah diajukan; harga tidak dapat dihitung ulang.');
  const { note } = customRevisionSchema.parse(req.body);
  await prisma.$transaction(async (tx) => {
    await tx.customRequest.update({ where: { id: current.id }, data: { status: 'revision_requested', revisionNote: note, agreedPrice: null, agreedAt: null, queuedAt: new Date(), claimedById: null, claimedAt: null } });
    if (current.status === 'agreed') await tx.prospect.update({ where: { id: prospect.id }, data: { dealValue: 0 } });
    await tx.prospectLog.create({
      data: {
        prospectId: prospect.id, userId: req.user!.id, actionType: 'custom_revision', title: 'Layanan custom diminta hitung ulang',
        description: [`Alasan: ${note}`, 'Harga sebelumnya:', describeQuote(current)].join('\n'),
      },
    });
  });
  emitToBrand(prospect.brandId, 'prospect:updated', { id: prospect.id });
  dispatch(() => notifyCustomSubmitted({ prospect, actor: req.user!, requestId: current.id, revision: true }));
  res.json({ success: true, data: await loadRequest(req) });
}));

/** Nilai deal akhir hasil negosiasi CS; ditolak bila di bawah harga terendah Tim LA. */
customRouter.post('/:id/agree', asyncHandler(async (req, res) => {
  const current = await loadRequest(req);
  const prospect = await loadProspect(req, current.prospectId);
  await assertCsCanEdit(req, prospect);
  if (current.status !== 'quoted' && current.status !== 'agreed') throw new HttpError(409, 'Harga belum dihitung Tim LA.');
  if (isExpired({ status: 'quoted', quoteValidUntil: current.quoteValidUntil })) {
    throw new HttpError(409, 'Masa berlaku harga sudah lewat. Minta hitung ulang ke Tim LA.');
  }
  if (!samePax(current, prospect)) throw new HttpError(409, 'Jumlah jamaah berubah setelah dihitung Tim LA. Minta hitung ulang.');
  const { agreedPrice } = customAgreeSchema.parse(req.body);
  const floor = Number(current.floorPrice ?? 0);
  if (agreedPrice < floor) {
    throw new HttpError(422, `Nilai deal ${formatRupiah(agreedPrice)} di bawah harga terendah ${formatRupiah(floor)}. Nilai ini tidak dapat disepakati.`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.customRequest.update({ where: { id: current.id }, data: { status: 'agreed', agreedPrice, agreedAt: new Date() } });
    await tx.prospect.update({ where: { id: prospect.id }, data: { dealValue: agreedPrice, packageId: current.basePackageId ?? null } });
    await tx.prospectLog.create({
      data: {
        prospectId: prospect.id, userId: req.user!.id, actionType: 'custom_agreed', title: `Harga custom disepakati: ${formatRupiah(agreedPrice)}`,
        description: `Ditawarkan ${formatRupiah(Number(current.offeredPrice ?? 0))} · terendah ${formatRupiah(floor)}`,
      },
    });
  });
  emitToBrand(prospect.brandId, 'prospect:updated', { id: prospect.id });
  dispatch(() => notifyCustomAgreed({ prospect, actor: req.user!, requestId: current.id, agreedPrice }));
  res.json({ success: true, data: await loadRequest(req) });
}));

customRouter.post('/:id/cancel', asyncHandler(async (req, res) => {
  const current = await loadRequest(req);
  const prospect = await loadProspect(req, current.prospectId);
  await assertCsCanEdit(req, prospect);
  if (current.status === 'cancelled') throw new HttpError(409, 'Permintaan sudah dibatalkan.');
  if (prospect.paymentProofUrl) throw new HttpError(409, 'Bukti transfer sudah diajukan; layanan custom tidak dapat dibatalkan dari sini.');
  const { note } = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body ?? {});
  await prisma.$transaction(async (tx) => {
    await tx.customRequest.update({ where: { id: current.id }, data: { status: 'cancelled' } });
    // Nilai deal custom tidak lagi berlaku; penawaran berikutnya dihitung ulang dari paket katalog.
    if (current.status === 'agreed') await tx.prospect.update({ where: { id: prospect.id }, data: { dealValue: 0 } });
    await tx.prospectLog.create({
      data: { prospectId: prospect.id, userId: req.user!.id, actionType: 'custom_cancelled', title: 'Layanan custom dibatalkan', description: note || null },
    });
  });
  emitToBrand(prospect.brandId, 'prospect:updated', { id: prospect.id });
  res.json({ success: true, data: await loadRequest(req) });
}));

// ───────────── Tim LA: hitung harga ─────────────
customRouter.post('/:id/quote', requireRole(...PRICING_ROLES), asyncHandler(async (req, res) => {
  const current = await loadRequest(req);
  if (!['submitted', 'revision_requested', 'quoted'].includes(current.status)) {
    throw new HttpError(409, current.status === 'agreed' ? 'Harga sudah disepakati CS dengan jamaah.' : 'Permintaan sudah dibatalkan.');
  }
  if (isWonStatus(current.prospect.status)) throw new HttpError(409, 'Prospek sudah Deal.');
  const input = customQuoteSchema.parse(req.body);
  // Harga harus dihitung dari versi kebutuhan terbaru (CS bisa mengubahnya saat Tim LA menghitung).
  const { version, force } = z.object({ version: z.string().optional(), force: z.boolean().optional() }).parse(req.body ?? {});
  if (current.claimedById && current.claimedById !== req.user!.id && !force) {
    throw new HttpError(409, `Sedang dihitung ${current.claimedBy?.name ?? 'anggota Tim LA lain'}. Konfirmasi untuk tetap mengirim harga.`);
  }
  if (version && version !== current.updatedAt.toISOString()) {
    throw new HttpError(409, 'Kebutuhan baru saja diubah CS. Muat ulang rincian sebelum mengirim harga.');
  }
  const validUntil = quoteValidUntil(input.validUntil);
  // Harga per jamaah wajib untuk setiap tipe kamar yang ada jamaahnya; total dihitung di server.
  const rooms = customRoomsFor(current);
  const unpriced = rooms.filter((room) => !input.offeredPrices[room.key] || !input.floorPrices[room.key]);
  if (unpriced.length) throw new HttpError(422, `Isi harga ditawarkan dan terendah untuk ${unpriced.map((room) => room.label).join(', ')}.`);
  const pick = (prices: CustomRoomPrices) => Object.fromEntries(rooms.map((room) => [room.key, prices[room.key]]));
  const offeredPrices = pick(input.offeredPrices);
  const floorPrices = pick(input.floorPrices);
  const hasInfant = current.paxInfant > 0;
  if (hasInfant && (input.minDpInfant === null || input.minDpInfant === undefined)) throw new HttpError(422, 'Isi DP minimal bayi (boleh 0).');
  const offeredTotal = customRoomTotal(offeredPrices, current)!;
  const floorTotal = customRoomTotal(floorPrices, current)!;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.customRequest.update({
      where: { id: current.id },
      data: {
        status: 'quoted', offeredPrices, floorPrices, offeredPrice: offeredTotal, floorPrice: floorTotal, minDpPerPax: input.minDpPerPax,
        minDpInfant: hasInfant ? input.minDpInfant : null, quoteCount: { increment: 1 }, claimedById: null, claimedAt: null,
        quoteValidUntil: validUntil, quoteNote: input.note, quotedById: req.user!.id, quotedAt: new Date(),
      },
    });
    await tx.prospectLog.create({
      data: {
        prospectId: current.prospectId, userId: req.user!.id, actionType: 'custom_quoted', title: 'Harga layanan custom dihitung Tim LA',
        description: [describeQuote(row), input.note ? `Catatan: ${input.note}` : null].filter(Boolean).join('\n'),
      },
    });
    return row;
  });
  emitToBrand(current.brandId, 'prospect:updated', { id: current.prospectId });
  dispatch(() => notifyCustomQuoted({ prospect: current.prospect, actor: req.user!, requestId: current.id, offeredPrice: Number(updated.offeredPrice) }));
  res.json({ success: true, data: await loadRequest(req) });
}));

/** Tim LA mengembalikan permintaan ke CS: data kurang, hotel penuh, atau tanggal tidak tersedia. */
customRouter.post('/:id/return', requireRole(...PRICING_ROLES), asyncHandler(async (req, res) => {
  const current = await loadRequest(req);
  if (!['submitted', 'revision_requested'].includes(current.status)) throw new HttpError(409, 'Hanya permintaan yang menunggu hitungan yang bisa dikembalikan.');
  const { note } = customReturnSchema.parse(req.body);
  await prisma.$transaction(async (tx) => {
    await tx.customRequest.update({ where: { id: current.id }, data: { status: 'needs_info', returnNote: note, claimedById: null, claimedAt: null } });
    await tx.prospectLog.create({
      data: { prospectId: current.prospectId, userId: req.user!.id, actionType: 'custom_returned', title: 'Layanan custom dikembalikan Tim LA ke CS', description: note },
    });
  });
  emitToBrand(current.brandId, 'prospect:updated', { id: current.prospectId });
  dispatch(() => notifyCustomReturned({ prospect: current.prospect, actor: req.user!, requestId: current.id, note }));
  res.json({ success: true, data: await loadRequest(req) });
}));

/** Tim LA mengambil permintaan untuk dihitung (atau mengambil alih) agar tidak dikerjakan ganda. */
customRouter.post('/:id/claim', requireRole(...PRICING_ROLES), asyncHandler(async (req, res) => {
  const current = await loadRequest(req);
  if (!['submitted', 'revision_requested', 'quoted'].includes(current.status)) throw new HttpError(409, 'Permintaan ini tidak sedang menunggu hitungan.');
  const takeover = Boolean(current.claimedById && current.claimedById !== req.user!.id);
  await prisma.$transaction(async (tx) => {
    await tx.customRequest.update({ where: { id: current.id }, data: { claimedById: req.user!.id, claimedAt: new Date() } });
    if (takeover) {
      await tx.prospectLog.create({
        data: { prospectId: current.prospectId, userId: req.user!.id, actionType: 'custom_claimed', title: `Hitungan custom diambil alih dari ${current.claimedBy?.name ?? 'Tim LA'}` },
      });
    }
  });
  res.json({ success: true, data: await loadRequest(req) });
}));

customRouter.post('/:id/release', requireRole(...PRICING_ROLES), asyncHandler(async (req, res) => {
  const current = await loadRequest(req);
  if (current.claimedById !== req.user!.id) throw new HttpError(409, 'Permintaan ini tidak sedang Anda hitung.');
  await prisma.customRequest.update({ where: { id: current.id }, data: { claimedById: null, claimedAt: null } });
  res.json({ success: true, data: await loadRequest(req) });
}));
