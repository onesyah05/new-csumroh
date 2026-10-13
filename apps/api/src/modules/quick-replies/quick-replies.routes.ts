import { Router, type Request } from 'express';
import type { Brand, Prospect } from '@prisma/client';
import { z } from 'zod';
import {
  fillQuickReply, firstNameOf, QUICK_REPLY_BODY_MAX, QUICK_REPLY_ROLES, QUICK_REPLY_SCOPES, QUICK_REPLY_SHORTCUT_MAX,
  QUICK_REPLY_TITLE_MAX,
} from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { authGuard, canAccessBrand, requireRole, scopedBrandId } from '../../middleware/auth.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { buildScriptContext } from '../scripts/context.js';

/**
 * Balas cepat: template dua cakupan. "brand" dilihat dan diubah siapa saja yang punya akses brand; "personal" hanya
 * pemiliknya. Menghapus template brand: pembuat atau Admin; template pribadi: pemilik.
 */
export const quickRepliesRouter = Router();
quickRepliesRouter.use(authGuard);
quickRepliesRouter.use(requireRole(...QUICK_REPLY_ROLES));

const isManager = (role: string) => role === 'admin' || role === 'superadmin';

function brandOf(req: Request) {
  const raw = Number(req.query.brandId ?? (req.body as { brandId?: unknown } | undefined)?.brandId);
  return scopedBrandId(req, Number.isInteger(raw) && raw > 0 ? raw : undefined);
}

const shortcutSchema = z.string().trim().max(QUICK_REPLY_SHORTCUT_MAX)
  .regex(/^[^\s/]*$/, 'Pintasan tidak boleh memakai spasi atau garis miring.')
  .transform((value) => value || null);

const serialize = (row: { id: number; brandId: number; scope: string; ownerId: number | null; title: string; shortcut: string | null; body: string; updatedAt: Date }) => ({
  id: row.id, brandId: row.brandId, scope: row.scope, ownerId: row.ownerId, title: row.title, shortcut: row.shortcut,
  body: row.body, updatedAt: row.updatedAt,
});

/** Template yang boleh dilihat user di brand itu: milik brand + miliknya sendiri. */
const visibleTo = (brandId: number, userId: number) => ({
  brandId,
  OR: [{ scope: 'brand' }, { scope: 'personal', ownerId: userId }],
});

quickRepliesRouter.get('/', asyncHandler(async (req, res) => {
  const brandId = brandOf(req);
  const prospectId = Number(req.query.prospectId) || null;
  const [rows, brand, prospect] = await Promise.all([
    prisma.quickReply.findMany({ where: visibleTo(brandId, req.user!.id), orderBy: [{ scope: 'asc' }, { title: 'asc' }] }),
    prospectId ? prisma.brand.findUniqueOrThrow({ where: { id: brandId } }) : null,
    prospectId ? prisma.prospect.findFirst({ where: { id: prospectId, brandId } }) : null,
  ]);
  if (prospectId && !prospect) throw new HttpError(404, 'Prospek tidak ditemukan di brand ini.');

  // Tanpa prospek tidak ada nilai untuk diisi: daftar tampil mentah (halaman kelola).
  const values = prospectId && brand ? await tokenValues({ brandId, csName: req.user!.name, brand, prospect }) : null;

  res.json({
    success: true,
    data: rows.map((row) => {
      const filled = values ? fillQuickReply(row.body, values) : null;
      return { ...serialize(row), text: filled?.text ?? row.body, missing: filled?.missing ?? [] };
    }),
  });
}));

const createSchema = z.object({
  scope: z.enum(QUICK_REPLY_SCOPES),
  title: z.string().trim().min(1, 'Judul wajib diisi').max(QUICK_REPLY_TITLE_MAX),
  shortcut: shortcutSchema.optional(),
  body: z.string().trim().min(1, 'Isi pesan wajib diisi').max(QUICK_REPLY_BODY_MAX),
});

quickRepliesRouter.post('/', asyncHandler(async (req, res) => {
  const brandId = brandOf(req);
  const input = createSchema.parse(req.body);
  const created = await prisma.quickReply.create({
    data: { brandId, scope: input.scope, ownerId: req.user!.id, title: input.title, shortcut: input.shortcut ?? null, body: input.body },
  });
  res.status(201).json({ success: true, data: serialize(created) });
}));

/** Nilai token untuk satu prospek: variabel script (brand, paket, profil) ditambah nama jamaah. */
async function tokenValues(input: { brandId: number; csName: string; brand: Brand; prospect: Prospect | null }) {
  const { brandId, prospect } = input;
  const packageId = prospect?.packageId ?? null;
  const pkg = packageId ? await prisma.package.findFirst({ where: { id: packageId, brandId } }) : null;
  const context = buildScriptContext({ csName: input.csName, brand: input.brand, pkg, prospect });
  return {
    ...context.variables,
    nama: firstNameOf(prospect?.name),
    nama_jamaah: prospect?.name?.trim() || null,
  } as Record<string, string | null | undefined>;
}

async function findEditable(req: Request) {
  const row = await prisma.quickReply.findUnique({ where: { id: Number(req.params.id) } });
  if (!row || !canAccessBrand(req.user!, row.brandId)) throw new HttpError(404, 'Balas cepat tidak ditemukan.');
  // Template pribadi tidak terlihat oleh orang lain: pura-pura tidak ada.
  if (row.scope === 'personal' && row.ownerId !== req.user!.id) throw new HttpError(404, 'Balas cepat tidak ditemukan.');
  return row;
}

const updateSchema = createSchema.omit({ scope: true }).partial();

// Template brand boleh diubah siapa saja yang punya akses brand; template pribadi hanya pemiliknya (findEditable).
quickRepliesRouter.patch('/:id', asyncHandler(async (req, res) => {
  const row = await findEditable(req);
  const input = updateSchema.parse(req.body);
  const updated = await prisma.quickReply.update({
    where: { id: row.id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.shortcut !== undefined ? { shortcut: input.shortcut } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
    },
  });
  res.json({ success: true, data: serialize(updated) });
}));

quickRepliesRouter.delete('/:id', asyncHandler(async (req, res) => {
  const row = await findEditable(req);
  if (row.scope === 'brand' && row.ownerId !== req.user!.id && !isManager(req.user!.role)) {
    throw new HttpError(403, 'Hanya pembuat atau Admin yang dapat menghapus balas cepat brand.');
  }
  await prisma.quickReply.delete({ where: { id: row.id } });
  res.json({ success: true });
}));
