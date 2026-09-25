import { Router } from 'express';
import { z } from 'zod';
import { parseRupiahStrict } from '@csumroh/shared-types';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { authGuard, requireRole, scopedBrandId } from '../../middleware/auth.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { FLYER_URL_PATTERN, LOGO_URL_PATTERN } from '../../utils/safe-path.js';
import { releaseProspectsOf } from '../prospects/pic.js';

// Tautan yang dirender sebagai <a href>: hanya http(s), mencegah skema javascript:/data:.
const httpsUrlSchema = z.union([
  z.string().trim().max(2000).regex(/^https?:\/\/\S+$/i, 'URL harus diawali http:// atau https://'),
  z.literal('').transform(() => null),
]).optional().nullable();

export const catalogRouter = Router();
catalogRouter.use(authGuard);

catalogRouter.get('/brands', asyncHandler(async (req, res) => {
  const isHoldingWide = req.user!.role === 'superadmin' || req.user!.role === 'admin' || req.user!.role === 'finance';
  const allowedBrandIds: number[] = [];
  if (!isHoldingWide) {
    if (req.user!.brandId) allowedBrandIds.push(req.user!.brandId);
    if (req.user!.userBrands && Array.isArray(req.user!.userBrands)) {
      for (const ub of req.user!.userBrands) {
        if (ub.brand?.id) allowedBrandIds.push(ub.brand.id);
      }
    }
  }

  const rows = isHoldingWide
    ? await prisma.brand.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { users: true, prospects: true, packages: true } }, whatsappSession: true } })
    : await prisma.brand.findMany({ where: { id: { in: allowedBrandIds.length > 0 ? allowedBrandIds : [-1] } }, include: { _count: { select: { users: true, prospects: true, packages: true } }, whatsappSession: true } });
  // QR pairing hanya untuk pengelola perangkat; siapa pun yang memindainya dapat menautkan sesi WA brand.
  const canPairDevice = req.user!.role === 'superadmin' || req.user!.role === 'admin';
  const data = rows.map(({ metaAccessToken: _secret, metaLastError: _privateError, whatsappSession, ...brand }) => ({
    ...brand,
    whatsappSession: whatsappSession && !canPairDevice ? { ...whatsappSession, qrCode: null } : whatsappSession,
  }));
  res.json({ success: true, data });
}));

catalogRouter.get('/brands/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const isHoldingWide = req.user!.role === 'superadmin' || req.user!.role === 'admin' || req.user!.role === 'finance';
  const hasAccess = isHoldingWide || req.user!.brandId === id || (req.user!.userBrands?.some((ub) => ub.brand?.id === id));
  if (!hasAccess) {
    throw new HttpError(403, 'Akses brand dibatasi.');
  }
  const brand = await prisma.brand.findUnique({
    where: { id },
    include: {
      _count: { select: { users: true, prospects: true, packages: true } },
      whatsappSession: true,
      packages: {
        orderBy: { departureDate: 'asc' },
        take: 10,
        select: {
          id: true,
          name: true,
          price: true,
          priceQuad: true,
          departureDate: true,
          departureInfo: true,
          duration: true,
          airline: true,
          quotaRemaining: true,
          isActive: true,
          isPromo: true,
          flyerImage: true,
        },
      },
      users: {
        where: { isActive: true },
        take: 15,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
        },
      },
    },
  });
  if (!brand) throw new HttpError(404, 'Brand tidak ditemukan.');
  const { metaAccessToken: _secret, metaLastError: _privateError, whatsappSession, ...rest } = brand;
  const canPairDevice = req.user!.role === 'superadmin' || req.user!.role === 'admin';
  const data = { ...rest, whatsappSession: whatsappSession && !canPairDevice ? { ...whatsappSession, qrCode: null } : whatsappSession };
  res.json({ success: true, data });
}));

// ── Upload Logo Brand (compress → WebP, max 512×512) ──────────────────────────
catalogRouter.post('/brands/upload-logo', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const { image } = req.body;
  if (!image || typeof image !== 'string') {
    throw new HttpError(400, 'Data gambar logo wajib disertakan.');
  }

  // Parse data URL
  let base64Data = image;
  if (image.startsWith('data:')) {
    const match = image.match(/^data:image\/[a-zA-Z0-9+]+;base64,(.+)$/);
    if (match && match[1]) {
      base64Data = match[1];
    } else {
      const commaIdx = image.indexOf(',');
      if (commaIdx !== -1) base64Data = image.slice(commaIdx + 1);
    }
  }

  const rawBuffer = Buffer.from(base64Data, 'base64');
  if (rawBuffer.length > 10 * 1024 * 1024) {
    throw new HttpError(400, 'Ukuran gambar melebihi batas maksimal 10 MB.');
  }

  // Validate magic bytes
  const isJpeg = rawBuffer.length > 3 && rawBuffer[0] === 0xFF && rawBuffer[1] === 0xD8 && rawBuffer[2] === 0xFF;
  const isPng = rawBuffer.length > 4 && rawBuffer[0] === 0x89 && rawBuffer[1] === 0x50 && rawBuffer[2] === 0x4E && rawBuffer[3] === 0x47;
  const isWebp = rawBuffer.length > 12 && rawBuffer.toString('utf8', 0, 4) === 'RIFF' && rawBuffer.toString('utf8', 8, 12) === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) {
    throw new HttpError(400, 'Format file tidak didukung. Harap gunakan gambar JPG, PNG, atau WEBP.');
  }

  // Compress & convert to WebP via sharp (max 512×512, quality 80)
  const webpBuffer = await sharp(rawBuffer)
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const uploadsDir = path.resolve(process.cwd(), 'uploads', 'brands');
  await fs.promises.mkdir(uploadsDir, { recursive: true });

  const safeName = `logo-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.webp`;
  const filePath = path.join(uploadsDir, safeName);
  await fs.promises.writeFile(filePath, webpBuffer);

  const fileUrl = `/uploads/brands/${safeName}`;
  res.json({
    success: true,
    data: {
      url: fileUrl,
      originalSize: rawBuffer.length,
      compressedSize: webpBuffer.length,
      filename: safeName,
    },
  });
}));

catalogRouter.post('/brands', requireRole('superadmin'), asyncHandler(async (req, res) => {
  const input = z.object({
    name: z.string().min(2, 'Nama brand minimal 2 karakter').max(100),
    code: z.string().min(2, 'Kode brand minimal 2 karakter').max(30).regex(/^[A-Z0-9_-]+$/, 'Kode brand hanya boleh berisi huruf kapital, angka, tanda strip (-), dan garis bawah (_)'),
    logoUrl: z.string().regex(LOGO_URL_PATTERN, 'Logo harus diunggah melalui fitur upload logo.').optional().nullable().or(z.literal('').transform(() => null)),
    ppiuNumber: z.string().max(100).optional().nullable(),
    bankName: z.string().max(50).optional().nullable(),
    bankAccountNumber: z.string().max(50).optional().nullable(),
    bankAccountHolder: z.string().max(100).optional().nullable(),
    address: z.string().optional().nullable(),
    gmapsUrl: httpsUrlSchema,
    phone: z.string().max(30).optional().nullable()
  }).parse(req.body);
  const data = await prisma.brand.create({ data: input as any });
  res.status(201).json({ success: true, data });
}));

catalogRouter.patch('/brands/:id', requireRole('superadmin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    name: z.string().min(2, 'Nama brand minimal 2 karakter').max(100).optional(),
    code: z.string().min(2, 'Kode brand minimal 2 karakter').max(30).regex(/^[A-Z0-9_-]+$/, 'Kode brand hanya boleh berisi huruf kapital, angka, tanda strip (-), dan garis bawah (_)').optional(),
    logoUrl: z.string().regex(LOGO_URL_PATTERN, 'Logo harus diunggah melalui fitur upload logo.').optional().nullable().or(z.literal('').transform(() => null)),
    ppiuNumber: z.string().max(100).optional().nullable(),
    bankName: z.string().max(50).optional().nullable(),
    bankAccountNumber: z.string().max(50).optional().nullable(),
    bankAccountHolder: z.string().max(100).optional().nullable(),
    address: z.string().optional().nullable(),
    gmapsUrl: httpsUrlSchema,
    phone: z.string().max(30).optional().nullable()
  });
  const input = schema.parse(req.body);
  const existing = await prisma.brand.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Brand tidak ditemukan.');

  // Hapus file logo lama jika diganti
  if (input.logoUrl !== undefined && existing.logoUrl && input.logoUrl !== existing.logoUrl) {
    const oldFile = path.resolve(process.cwd(), 'uploads', 'brands', path.basename(existing.logoUrl));
    fs.promises.unlink(oldFile).catch(() => {});
  }

  const data = await prisma.brand.update({ where: { id }, data: input as any });
  res.json({ success: true, data });
}));

catalogRouter.delete('/brands/:id', requireRole('superadmin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.brand.findUnique({
    where: { id },
    include: {
      _count: { select: { prospects: true, packages: true, users: true } },
    },
  });
  if (!existing) throw new HttpError(404, 'Brand tidak ditemukan.');
  if (existing._count.prospects > 0 || existing._count.packages > 0) {
    throw new HttpError(
      400,
      `Brand "${existing.name}" tidak dapat dihapus karena memiliki ${existing._count.prospects} data prospek dan ${existing._count.packages} paket operasional. Hubungi tim holding untuk pengarsipan.`
    );
  }

  try {
    await fetch(`${env.WA_GATEWAY_URL}/sessions/${id}/logout`, {
      method: 'POST',
      headers: { 'x-internal-secret': env.WA_GATEWAY_SECRET },
    }).catch(() => null);
  } catch {}

  await prisma.brand.delete({ where: { id } });
  res.json({ success: true, message: `Brand "${existing.name}" berhasil dihapus.` });
}));

const AMBIGUOUS_RUPIAH = 'Nominal tidak terbaca. Tulis seperti "Rp 36.500.000" atau "36,5 juta".';
const rupiahText = (required: string) => z.string().min(1, required).max(50)
  .refine((value) => (parseRupiahStrict(value) ?? 0) > 0, AMBIGUOUS_RUPIAH);
const optionalRupiahText = z.string().max(50).optional().nullable()
  .refine((value) => !value?.trim() || parseRupiahStrict(value) !== null, AMBIGUOUS_RUPIAH);

const packageInputSchema = z.object({
  brandId: z.number().int().positive().optional(),
  name: z.string().min(2, 'Nama paket minimal 2 karakter').max(150),
  // Nominal harus terbaca jelas (mis. "Rp 36.500.000" atau "36,5 juta"); format ambigu ditolak, bukan ditebak.
  price: rupiahText('Harga acuan (Quad) wajib diisi'),
  dp: rupiahText('DP wajib diisi'),
  priceQuad: optionalRupiahText,
  priceTriple: optionalRupiahText,
  priceDouble: optionalRupiahText,
  priceInfant: optionalRupiahText,
  quotaRemaining: z.number().int().nonnegative().optional().nullable(),
  departureDate: z.string().optional().nullable(),
  departureInfo: z.string().max(100).optional().nullable(),
  airline: z.string().max(100).optional().nullable(),
  flightType: z.string().max(50).optional().nullable(),
  hotelMakkah: z.string().max(100).optional().nullable(),
  hotelMadinah: z.string().max(100).optional().nullable(),
  duration: z.string().max(50).optional().nullable(),
  facilitiesIncluded: z.string().optional().nullable(),
  facilitiesExcluded: z.string().optional().nullable(),
  itinerary: z.string().optional().nullable(),
  highlights: z.string().optional().nullable(),
  // Hanya URL hasil /packages/upload-flyer; path/URL bebas ditolak (R08).
  flyerImage: z.string().regex(FLYER_URL_PATTERN, 'Flyer harus diunggah melalui fitur upload flyer.').optional().nullable().or(z.literal('').transform(() => null)),
  isPromo: z.boolean().optional(),
  promoDiscount: z.string().max(50).optional().nullable(),
  promoDeadline: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

catalogRouter.get('/packages', asyncHandler(async (req, res) => {
  const brandId = req.user!.role === 'superadmin'
    ? (req.query.brandId ? Number(req.query.brandId) : undefined)
    : req.user!.brandId ?? undefined;

  const where: any = {};
  if (brandId) where.brandId = brandId;

  // Search filter
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { airline: { contains: q } },
      { hotelMakkah: { contains: q } },
      { hotelMadinah: { contains: q } },
      { departureInfo: { contains: q } },
      { brand: { name: { contains: q } } },
    ];
  }

  // Month filter (YYYY-MM)
  const month = typeof req.query.month === 'string' ? req.query.month.trim() : '';
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const parts = month.split('-');
    const year = Number(parts[0]);
    const m = Number(parts[1]);
    if (!Number.isNaN(year) && !Number.isNaN(m)) {
      const startOfMonth = new Date(year, m - 1, 1);
      const endOfMonth = new Date(year, m, 0, 23, 59, 59, 999);
      where.departureDate = { gte: startOfMonth, lte: endOfMonth };
    }
  }

  // Quota filter
  const quota = typeof req.query.quota === 'string' ? req.query.quota.trim() : '';
  if (quota === 'available') {
    where.quotaRemaining = { gt: 0 };
  } else if (quota === 'low') {
    where.quotaRemaining = { gt: 0, lte: 5 };
  } else if (quota === 'sold_out') {
    where.OR = (where.OR || []).concat([{ quotaRemaining: 0 }, { quotaRemaining: null }]);
  }

  // Status filter
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  if (status === 'active') {
    where.isActive = true;
  } else if (status === 'archived') {
    where.isActive = false;
  }

  const data = await prisma.package.findMany({
    where,
    include: { brand: { select: { id: true, name: true, code: true } } },
    orderBy: [{ departureDate: 'asc' }, { id: 'desc' }],
  });
  res.json({ success: true, data });
}));

catalogRouter.get('/packages/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const item = await prisma.package.findUnique({
    where: { id },
    include: { brand: { select: { id: true, name: true, code: true, phone: true, ppiuNumber: true } } },
  });
  if (!item) throw new HttpError(404, 'Paket umroh tidak ditemukan.');
  if (req.user!.role !== 'superadmin' && item.brandId !== req.user!.brandId) {
    throw new HttpError(403, 'Akses paket antar-brand dibatasi.');
  }
  res.json({ success: true, data: item });
}));

catalogRouter.post('/packages/upload-flyer', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const { image } = req.body;
  if (!image || typeof image !== 'string') {
    throw new HttpError(400, 'Data gambar poster flyer wajib disertakan.');
  }

  // Parse data URL (supports image/webp, image/jpeg, image/png)
  let base64Data = image;
  let extension = 'webp';
  if (image.startsWith('data:')) {
    const match = image.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
    if (match && match[1] && match[2]) {
      const mimeSubtype = match[1].toLowerCase();
      extension = mimeSubtype === 'jpeg' ? 'jpg' : mimeSubtype;
      base64Data = match[2];
    } else {
      const commaIdx = image.indexOf(',');
      if (commaIdx !== -1) {
        base64Data = image.slice(commaIdx + 1);
      }
    }
  }

  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > 5 * 1024 * 1024) {
    throw new HttpError(400, 'Ukuran gambar melebihi batas maksimal 5MB.');
  }

  // Validate magic bytes to ensure safe image formats
  const isJpeg = buffer.length > 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  const isPng = buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  const isWebp = buffer.length > 12 && buffer.toString('utf8', 0, 4) === 'RIFF' && buffer.toString('utf8', 8, 12) === 'WEBP';

  if (!isJpeg && !isPng && !isWebp) {
    throw new HttpError(400, 'Format file tidak didukung. Harap gunakan gambar JPG, PNG, atau WEBP yang valid.');
  }
  if (isJpeg) extension = 'jpg';
  else if (isPng) extension = 'png';
  else if (isWebp) extension = 'webp';

  const uploadsDir = path.resolve(process.cwd(), 'uploads', 'packages');
  await fs.promises.mkdir(uploadsDir, { recursive: true });

  const safeName = `flyer-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${extension}`;
  const filePath = path.join(uploadsDir, safeName);
  await fs.promises.writeFile(filePath, buffer);

  const fileUrl = `/uploads/packages/${safeName}`;
  res.json({
    success: true,
    data: {
      url: fileUrl,
      size: buffer.length,
      filename: safeName,
    },
  });
}));

catalogRouter.post('/packages', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const input = packageInputSchema.parse(req.body);
  const brandId = scopedBrandId(req, input.brandId);

  // Generate departure info string if date supplied and info empty
  let departureInfo = input.departureInfo;
  if (!departureInfo && input.departureDate) {
    const d = new Date(input.departureDate);
    departureInfo = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  const data = await prisma.package.create({
    data: {
      ...input,
      brandId,
      departureInfo: departureInfo || null,
      departureDate: input.departureDate ? new Date(input.departureDate) : null,
      promoDeadline: input.promoDeadline ? new Date(input.promoDeadline) : null,
      priceQuad: input.priceQuad || input.price,
      highlights: input.highlights || (input.facilitiesIncluded ? input.facilitiesIncluded.slice(0, 250) : null),
    },
    include: { brand: { select: { id: true, name: true, code: true } } },
  });
  res.status(201).json({ success: true, data });
}));

catalogRouter.patch('/packages/:id', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.package.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Paket umroh tidak ditemukan.');
  if (req.user!.role === 'admin' && existing.brandId !== req.user!.brandId) {
    throw new HttpError(403, 'Admin hanya dapat mengelola paket pada brand sendiri.');
  }

  const schema = packageInputSchema.partial();
  const input = schema.parse(req.body);

  let departureInfo = input.departureInfo;
  if (departureInfo === undefined && input.departureDate) {
    const d = new Date(input.departureDate);
    departureInfo = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  const updatePayload: any = { ...input };
  if (input.departureDate !== undefined) {
    updatePayload.departureDate = input.departureDate ? new Date(input.departureDate) : null;
  }
  if (departureInfo !== undefined) {
    updatePayload.departureInfo = departureInfo;
  }
  if (input.promoDeadline !== undefined) {
    updatePayload.promoDeadline = input.promoDeadline ? new Date(input.promoDeadline) : null;
  }
  if (input.price && !input.priceQuad && !existing.priceQuad) {
    updatePayload.priceQuad = input.price;
  }
  if (req.user!.role === 'superadmin' && input.brandId) {
    updatePayload.brandId = input.brandId;
  } else {
    delete updatePayload.brandId;
  }

  const data = await prisma.package.update({
    where: { id },
    data: updatePayload,
    include: { brand: { select: { id: true, name: true, code: true } } },
  });
  res.json({ success: true, data });
}));

catalogRouter.patch('/packages/:id/toggle', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.package.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Paket umroh tidak ditemukan.');
  if (req.user!.role === 'admin' && existing.brandId !== req.user!.brandId) {
    throw new HttpError(403, 'Admin hanya dapat mengelola paket pada brand sendiri.');
  }

  const data = await prisma.package.update({
    where: { id },
    data: { isActive: !existing.isActive },
    include: { brand: { select: { id: true, name: true, code: true } } },
  });
  res.json({ success: true, data });
}));

catalogRouter.delete('/packages/:id', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.package.findUnique({
    where: { id },
    include: { _count: { select: { prospects: true } } },
  });
  if (!existing) throw new HttpError(404, 'Paket umroh tidak ditemukan.');
  if (req.user!.role === 'admin' && existing.brandId !== req.user!.brandId) {
    throw new HttpError(403, 'Admin hanya dapat mengelola paket pada brand sendiri.');
  }

  if (existing._count?.prospects > 0) {
    await prisma.package.update({
      where: { id },
      data: { isActive: false },
    });
    res.json({
      success: true,
      message: `Paket umroh "${existing.name}" memiliki ${existing._count.prospects} riwayat prospek/transaksi, sehingga dinonaktifkan (diarsipkan) demi menjaga integritas data historis.`,
    });
    return;
  }

  await prisma.package.delete({ where: { id } });
  res.json({ success: true, message: 'Paket umroh berhasil dihapus.' });
}));

catalogRouter.get('/users', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  // Superadmin: semua staf bila tanpa brandId. Admin (pengawas holding): brand yang diminta, default brand utama.
  const requested = req.query.brandId ? Number(req.query.brandId) : undefined;
  const brandId = req.user!.role === 'superadmin'
    ? requested
    : requested ? scopedBrandId(req, requested) : req.user!.brandId ?? undefined;
  const data = await prisma.user.findMany({
    where: brandId
      ? {
          OR: [
            { brandId },
            { userBrands: { some: { brandId } } },
          ],
        }
      : {},
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      brandId: true,
      isActive: true,
      createdAt: true,
      brand: { select: { id: true, name: true, code: true } },
      userBrands: { select: { brand: { select: { id: true, name: true, code: true } } } },
    },
    orderBy: { name: 'asc' },
  });
  res.json({ success: true, data });
}));

catalogRouter.post('/users', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const input = z.object({
    brandId: z.number().int().positive().optional(),
    brandIds: z.array(z.number().int().positive()).optional(),
    name: z.string().min(2).max(100),
    email: z.string().email(),
    password: z.string().min(8).max(128),
    role: z.enum(['admin', 'cs', 'finance', 'product']).default('cs'),
  }).parse(req.body);

  if (req.user!.role === 'admin' && input.role !== 'cs') {
    throw new HttpError(403, 'Admin brand hanya dapat membuat akun CS.');
  }

  const existingEmail = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (existingEmail) {
    throw new HttpError(409, `Email ${input.email} sudah terdaftar.`);
  }

  let effectiveBrandId: number | null = null;
  let allBrandIds: number[] = [];

  if (req.user!.role === 'admin') {
    effectiveBrandId = req.user!.brandId ?? null;
    allBrandIds = effectiveBrandId ? [effectiveBrandId] : [];
  } else {
    allBrandIds = [...new Set([...(input.brandIds || []), ...(input.brandId ? [input.brandId] : [])])].filter(Boolean);
    // Tim LA melayani semua brand holding: tidak terikat brand.
    if (input.role === 'product') allBrandIds = [];
    else if (allBrandIds.length === 0) throw new HttpError(422, 'Pilih minimal satu brand.');
    effectiveBrandId = allBrandIds[0] ?? null;
  }

  const password = await bcrypt.hash(input.password, 12);
  const data = await prisma.user.create({
    data: {
      brandId: effectiveBrandId,
      name: input.name,
      email: input.email.toLowerCase(),
      password,
      role: input.role,
      userBrands: allBrandIds.length > 0 ? {
        create: allBrandIds.map((bid) => ({ brandId: bid })),
      } : undefined,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      brandId: true,
      isActive: true,
      createdAt: true,
      brand: { select: { id: true, name: true, code: true } },
      userBrands: { select: { brand: { select: { id: true, name: true, code: true } } } },
    },
  });
  res.status(201).json({ success: true, data });
}));

// Assign/update brands for a CS user
catalogRouter.put('/users/:id/brands', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const input = z.object({
    brandIds: z.array(z.number().int().positive()),
  }).parse(req.body);

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw new HttpError(404, 'User tidak ditemukan.');
  if (target.role === 'superadmin') throw new HttpError(400, 'Superadmin tidak terikat pada brand tertentu.');
  if (req.user!.role === 'admin' && (target.brandId !== req.user!.brandId || target.role !== 'cs')) {
    throw new HttpError(403, 'Admin hanya dapat mengelola CS pada brand sendiri.');
  }

  const uniqueBrandIds = [...new Set(input.brandIds)];

  await prisma.$transaction([
    prisma.userBrand.deleteMany({ where: { userId: id } }),
    prisma.user.update({
      where: { id },
      data: { brandId: uniqueBrandIds[0] ?? null },
    }),
    ...uniqueBrandIds.map((brandId) => prisma.userBrand.create({ data: { userId: id, brandId } })),
  ]);

  // Prospek terbuka di brand yang aksesnya dicabut kembali ke antrean brand tersebut.
  const releasedProspects = await releaseProspectsOf(id, {
    actor: req.user!,
    reason: `akses brand ${target.name} dicabut`,
    keepBrandIds: uniqueBrandIds,
  });

  const updated = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      role: true,
      brand: { select: { id: true, name: true, code: true } },
      userBrands: { select: { brand: { select: { id: true, name: true, code: true } } } },
    },
  });
  res.json({ success: true, data: { ...updated, releasedProspects } });
}));

catalogRouter.patch('/users/:id/toggle', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
  if (!target) throw new HttpError(404, 'User tidak ditemukan.');
  if (req.user!.role === 'admin' && (target.brandId !== req.user!.brandId || target.role !== 'cs')) {
    throw new HttpError(403, 'Admin hanya dapat mengelola CS pada brand sendiri.');
  }
  const data = await prisma.user.update({
    where: { id: target.id },
    data: { isActive: !target.isActive },
    select: { id: true, isActive: true },
  });
  // CS nonaktif tidak bisa membalas: prospek terbukanya kembali ke antrean agar bisa diklaim CS lain.
  const releasedProspects = data.isActive ? 0 : await releaseProspectsOf(target.id, {
    actor: req.user!, reason: `${target.name} dinonaktifkan`,
  });
  res.json({ success: true, data: { ...data, releasedProspects } });
}));

catalogRouter.patch('/users/:id', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const input = z.object({
    name: z.string().min(2).max(100).optional(),
    email: z.string().email().optional(),
    password: z.string().min(8).max(128).optional(),
    role: z.enum(['admin', 'cs', 'finance', 'product']).optional(),
    brandId: z.number().int().positive().nullable().optional(),
    brandIds: z.array(z.number().int().positive()).optional(),
  }).parse(req.body);

  const target = await prisma.user.findUnique({
    where: { id },
    include: { userBrands: true },
  });
  if (!target) throw new HttpError(404, 'User tidak ditemukan.');

  if (req.user!.role === 'admin') {
    if (target.brandId !== req.user!.brandId || target.role !== 'cs') {
      throw new HttpError(403, 'Admin hanya dapat mengelola CS pada brand sendiri.');
    }
    if (input.role && input.role !== 'cs') {
      throw new HttpError(403, 'Admin tidak dapat mengubah role menjadi Admin.');
    }
  }

  if (target.role === 'superadmin' && req.user!.role !== 'superadmin') {
    throw new HttpError(403, 'Tidak diizinkan mengedit akun Superadmin.');
  }

  const updateData: any = {};
  if (input.name) updateData.name = input.name;
  if (input.email && input.email.toLowerCase() !== target.email.toLowerCase()) {
    const emailExists = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (emailExists) throw new HttpError(409, `Email ${input.email} sudah digunakan akun lain.`);
    updateData.email = input.email.toLowerCase();
  }
  if (input.password) {
    updateData.password = await bcrypt.hash(input.password, 12);
  }
  // Perubahan role hanya bila benar-benar berbeda; role superadmin dan role diri sendiri tidak dapat
  // diubah lewat endpoint ini (mencegah demosi tak sengaja dari form edit).
  if (input.role && input.role !== target.role) {
    if (target.role === 'superadmin') throw new HttpError(403, 'Role Superadmin tidak dapat diubah.');
    if (target.id === req.user!.id) throw new HttpError(403, 'Anda tidak dapat mengubah role akun sendiri.');
    if (req.user!.role !== 'superadmin') throw new HttpError(403, 'Hanya Superadmin yang dapat mengubah role staf.');
    updateData.role = input.role;
  }

  let newBrandIds = input.brandIds;

  if (input.brandIds !== undefined) {
    if (input.brandIds.length > 0) {
      updateData.brandId = input.brandIds[0];
      newBrandIds = [...new Set(input.brandIds)];
    } else {
      updateData.brandId = null;
      newBrandIds = [];
    }
  } else if (input.brandId !== undefined) {
    updateData.brandId = input.brandId;
    newBrandIds = input.brandId ? [input.brandId] : [];
  }

  if (newBrandIds !== undefined) {
    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: updateData }),
      prisma.userBrand.deleteMany({ where: { userId: id } }),
      ...newBrandIds.map((bId) => prisma.userBrand.create({ data: { userId: id, brandId: bId } })),
    ]);
  } else if (Object.keys(updateData).length > 0) {
    await prisma.user.update({ where: { id }, data: updateData });
  }

  // PIC hanya untuk CS dengan akses brand prospeknya: ganti role atau cabut brand melepas prospek terbuka yang terdampak.
  let releasedProspects = 0;
  const finalRole = updateData.role ?? target.role;
  if (finalRole !== 'cs' && target.role === 'cs') {
    releasedProspects = await releaseProspectsOf(id, { actor: req.user!, reason: `${target.name} tidak lagi menjadi CS` });
  } else if (finalRole === 'cs' && newBrandIds !== undefined) {
    releasedProspects = await releaseProspectsOf(id, {
      actor: req.user!,
      reason: `akses brand ${target.name} dicabut`,
      keepBrandIds: newBrandIds,
    });
  }

  const updated = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      brandId: true,
      isActive: true,
      createdAt: true,
      brand: { select: { id: true, name: true, code: true } },
      userBrands: { select: { brand: { select: { id: true, name: true, code: true } } } },
    },
  });
  res.json({ success: true, data: { ...updated, releasedProspects } });
}));

catalogRouter.delete('/users/:id', requireRole('superadmin', 'admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw new HttpError(404, 'User tidak ditemukan.');

  if (req.user!.id === id) {
    throw new HttpError(400, 'Tidak dapat menghapus akun Anda sendiri.');
  }

  if (target.role === 'superadmin') {
    throw new HttpError(403, 'Tidak dapat menghapus akun Superadmin.');
  }

  if (req.user!.role === 'admin' && (target.brandId !== req.user!.brandId || target.role !== 'cs')) {
    throw new HttpError(403, 'Admin hanya dapat menghapus akun CS pada brand sendiri.');
  }

  // Dicatat sebelum hapus: relasi SetNull akan mengosongkan PIC tanpa jejak di riwayat prospek.
  const releasedProspects = await releaseProspectsOf(id, { actor: req.user!, reason: `akun ${target.name} dihapus` });
  await prisma.user.delete({ where: { id } });
  res.json({
    success: true,
    data: { releasedProspects },
    message: `Staf "${target.name}" berhasil dihapus.${releasedProspects ? ` ${releasedProspects} prospek terbuka kembali ke antrean "Belum ada PIC".` : ''}`,
  });
}));

