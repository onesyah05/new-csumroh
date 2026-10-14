import { Router, type Request } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { GALLERY_IMAGE_MAX_MB, GALLERY_ROLES, GALLERY_VIDEO_MAX_MB } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { authGuard, canAccessBrand, requireRole, scopedBrandId } from '../../middleware/auth.js';
import { asyncHandler, HttpError } from '../../utils/http.js';

/**
 * Galeri media bersama per brand: semua staf brand melihat dan mengunggah; setiap berkas mencatat pengunggah dan
 * waktunya. Hanya pengunggah atau Admin yang menghapus. Berkas disajikan lewat /uploads/gallery (hanya staf masuk).
 */
export const galleryRouter = Router();
galleryRouter.use(authGuard);
galleryRouter.use(requireRole(...GALLERY_ROLES));

const IMAGE_MAX_BYTES = GALLERY_IMAGE_MAX_MB * 1024 * 1024;
const VIDEO_MAX_BYTES = GALLERY_VIDEO_MAX_MB * 1024 * 1024;
const PAGE_SIZE = 60;
/** Batas piksel gambar masuk (≈64 MP: kamera HP 50 MP lolos, gambar bom dekompresi ditolak). */
const MAX_INPUT_PIXELS = 64_000_000;
const isManager = (role: string) => role === 'admin' || role === 'superadmin';
/** Pengunggah atau Admin boleh mengubah/menghapus media. */
const canModify = (user: { id: number; role: string }, uploadedById: number | null) => uploadedById === user.id || isManager(user.role);
/** Brand MP4/ISO-BMFF yang sah untuk video; HEIC, AVIF, M4A, QuickTime memakai kotak 'ftyp' juga tetapi bukan video web. */
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'MSNV', 'M4V ']);

function brandOf(req: Request) {
  const raw = Number(req.query.brandId ?? (req.body as { brandId?: unknown } | undefined)?.brandId);
  return scopedBrandId(req, Number.isInteger(raw) && raw > 0 ? raw : undefined);
}

/** Jenis berkas dari magic bytes, bukan dari nama atau tipe yang dikirim klien. */
export function sniffMedia(buffer: Buffer): 'image' | 'video' | null {
  const jpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const webp = buffer.length > 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP';
  if (jpeg || png || webp) return 'image';
  if (buffer.length > 12 && buffer.toString('latin1', 4, 8) === 'ftyp' && MP4_BRANDS.has(buffer.toString('latin1', 8, 12))) return 'video';
  return null;
}

const serialize = (asset: {
  id: number; brandId: number; folderId: number | null; name: string; url: string; mimeType: string; size: number;
  width: number | null; height: number | null; createdAt: Date; uploadedBy: { id: number; name: string } | null;
}) => ({
  id: asset.id, brandId: asset.brandId, folderId: asset.folderId, name: asset.name, url: asset.url, mimeType: asset.mimeType,
  size: asset.size, width: asset.width, height: asset.height, createdAt: asset.createdAt, uploadedBy: asset.uploadedBy,
});
const assetInclude = { uploadedBy: { select: { id: true, name: true } } } as const;

galleryRouter.get('/folders', asyncHandler(async (req, res) => {
  const brandId = brandOf(req);
  const [folders, total] = await Promise.all([
    prisma.mediaFolder.findMany({
      where: { brandId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { assets: true } }, createdBy: { select: { id: true, name: true } } },
    }),
    prisma.mediaAsset.count({ where: { brandId } }),
  ]);
  res.json({
    success: true,
    data: {
      total,
      folders: folders.map((f) => ({ id: f.id, name: f.name, count: f._count.assets, createdBy: f.createdBy, createdAt: f.createdAt })),
    },
  });
}));

galleryRouter.post('/folders', asyncHandler(async (req, res) => {
  const brandId = brandOf(req);
  const { name } = z.object({ name: z.string().trim().min(1, 'Nama folder wajib diisi').max(80) }).parse(req.body);
  const duplicate = await prisma.mediaFolder.findUnique({ where: { brandId_name: { brandId, name } } });
  if (duplicate) throw new HttpError(409, 'Folder dengan nama itu sudah ada.');
  const folder = await prisma.mediaFolder.create({ data: { brandId, name, createdById: req.user!.id } });
  res.status(201).json({ success: true, data: { id: folder.id, name: folder.name, count: 0 } });
}));

// Folder dihapus; isinya tetap ada dan kembali ke "Upload terbaru" (tanpa folder).
galleryRouter.delete('/folders/:id', asyncHandler(async (req, res) => {
  const folder = await prisma.mediaFolder.findUnique({ where: { id: Number(req.params.id) } });
  if (!folder || !canAccessBrand(req.user!, folder.brandId)) throw new HttpError(404, 'Folder tidak ditemukan.');
  if (!canModify(req.user!, folder.createdById)) {
    throw new HttpError(403, 'Hanya pembuat folder atau Admin yang dapat menghapus folder.');
  }
  await prisma.mediaFolder.delete({ where: { id: folder.id } });
  res.json({ success: true });
}));

galleryRouter.get('/assets', asyncHandler(async (req, res) => {
  const brandId = brandOf(req);
  const query = z.object({
    folderId: z.coerce.number().int().positive().optional(),
    q: z.string().trim().max(80).optional(),
    cursor: z.coerce.number().int().positive().optional(),
  }).parse(req.query);
  const rows = await prisma.mediaAsset.findMany({
    where: {
      brandId,
      ...(query.folderId ? { folderId: query.folderId } : {}),
      ...(query.q ? { name: { contains: query.q } } : {}),
      ...(query.cursor ? { id: { lt: query.cursor } } : {}),
    },
    orderBy: { id: 'desc' },
    take: PAGE_SIZE + 1,
    include: assetInclude,
  });
  const page = rows.slice(0, PAGE_SIZE);
  res.json({ success: true, data: { items: page.map(serialize), nextCursor: rows.length > PAGE_SIZE ? page[page.length - 1]!.id : null } });
}));

galleryRouter.post('/assets', asyncHandler(async (req, res) => {
  const brandId = brandOf(req);
  const input = z.object({
    name: z.string().trim().min(1).max(160),
    data: z.string().min(1),
    folderId: z.number().int().positive().nullable().optional(),
  }).parse(req.body);

  if (input.folderId) {
    const folder = await prisma.mediaFolder.findUnique({ where: { id: input.folderId } });
    if (!folder || folder.brandId !== brandId) throw new HttpError(400, 'Folder tidak ditemukan di brand ini.');
  }

  const base64 = input.data.includes(',') ? input.data.slice(input.data.indexOf(',') + 1) : input.data;
  const raw = Buffer.from(base64, 'base64');
  const kind = sniffMedia(raw);
  if (!kind) throw new HttpError(400, 'Format tidak didukung. Gunakan gambar JPG, PNG, WEBP, atau video MP4.');
  if (raw.length > (kind === 'image' ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES)) {
    throw new HttpError(400, `Ukuran ${kind === 'image' ? `gambar maksimal ${GALLERY_IMAGE_MAX_MB} MB` : `video maksimal ${GALLERY_VIDEO_MAX_MB} MB`}.`);
  }

  let output = raw;
  let width: number | null = null;
  let height: number | null = null;
  let extension = 'mp4';
  let mimeType = 'video/mp4';
  if (kind === 'image') {
    // Batas piksel: gambar kecil berkas tetapi puluhan ribu piksel per sisi tidak boleh menghabiskan memori server.
    const converted = await sharp(raw, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true })
      .catch(() => { throw new HttpError(400, 'Gambar tidak dapat diproses atau resolusinya terlalu besar.'); });
    output = converted.data;
    width = converted.info.width;
    height = converted.info.height;
    extension = 'webp';
    mimeType = 'image/webp';
  }

  const dir = path.resolve(process.cwd(), 'uploads', 'gallery');
  await fs.promises.mkdir(dir, { recursive: true });
  // Acak kriptografis: awalan g<brand>- dipakai pemeriksaan akses per brand, sisanya tidak boleh bisa ditebak.
  const fileName = `g${brandId}-${Date.now()}-${randomBytes(8).toString('hex')}.${extension}`;
  await fs.promises.writeFile(path.join(dir, fileName), output);

  const asset = await prisma.mediaAsset.create({
    data: {
      brandId, folderId: input.folderId ?? null, name: input.name, url: `/uploads/gallery/${fileName}`,
      mimeType, size: output.length, width, height, uploadedById: req.user!.id,
    },
    include: assetInclude,
  });
  res.status(201).json({ success: true, data: serialize(asset) });
}));

// Ganti nama tampilan dan/atau pindah folder (berkas di disk tetap). Aturan sama dengan hapus: pengunggah atau Admin.
galleryRouter.patch('/assets/:id', asyncHandler(async (req, res) => {
  const input = z.object({
    name: z.string().trim().min(1, 'Nama media wajib diisi').max(160).optional(),
    folderId: z.number().int().positive().nullable().optional(),
  }).refine((value) => value.name !== undefined || value.folderId !== undefined, 'Tidak ada perubahan.').parse(req.body);
  const asset = await prisma.mediaAsset.findUnique({ where: { id: Number(req.params.id) } });
  if (!asset || !canAccessBrand(req.user!, asset.brandId)) throw new HttpError(404, 'Media tidak ditemukan.');
  if (!canModify(req.user!, asset.uploadedById)) {
    throw new HttpError(403, 'Hanya pengunggah atau Admin yang dapat mengubah media ini.');
  }
  if (input.folderId) {
    const folder = await prisma.mediaFolder.findUnique({ where: { id: input.folderId } });
    if (!folder || folder.brandId !== asset.brandId) throw new HttpError(400, 'Folder tidak ditemukan di brand ini.');
  }
  const updated = await prisma.mediaAsset.update({
    where: { id: asset.id },
    data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.folderId !== undefined ? { folderId: input.folderId } : {}) },
    include: assetInclude,
  });
  res.json({ success: true, data: serialize(updated) });
}));

galleryRouter.delete('/assets/:id', asyncHandler(async (req, res) => {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: Number(req.params.id) } });
  if (!asset || !canAccessBrand(req.user!, asset.brandId)) throw new HttpError(404, 'Media tidak ditemukan.');
  if (!canModify(req.user!, asset.uploadedById)) {
    throw new HttpError(403, 'Hanya pengunggah atau Admin yang dapat menghapus media ini.');
  }
  await prisma.mediaAsset.delete({ where: { id: asset.id } });
  // File dihapus setelah baris DB hilang; gagal menghapus file tidak menggagalkan permintaan.
  fs.promises.unlink(path.resolve(process.cwd(), 'uploads', 'gallery', path.basename(asset.url))).catch(() => undefined);
  res.json({ success: true });
}));
