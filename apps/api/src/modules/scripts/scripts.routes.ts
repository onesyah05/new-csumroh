import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { transformScriptTree } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { authGuard, scopedBrandId } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/http.js';

export const scriptsRouter = Router();
scriptsRouter.use(authGuard);
const categories = ['greeting', 'identification', 'offer', 'objection', 'closing', 'followups'] as const;

async function readScript(name: string) {
  const file = path.resolve(process.cwd(), '../../packages/scripts-data/scripts-chat', `${name}.json`);
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

scriptsRouter.get('/', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const [brand, selectedPackage, data] = await Promise.all([
    prisma.brand.findUniqueOrThrow({ where: { id: brandId } }),
    req.query.packageId ? prisma.package.findFirst({ where: { id: Number(req.query.packageId), brandId } }) : null,
    Promise.all(categories.map(async (category) => [category, await readScript(category)] as const)),
  ]);
  const variables = {
    nama: String(req.query.nama ?? ''), cs_name: req.user!.name, travel: brand.name, ppiu: brand.ppiuNumber ?? '',
    bank: brand.bankName ?? '', rekening: brand.bankAccountNumber ?? '', nama_rekening: brand.bankAccountHolder ?? '',
    alamat: brand.address ?? '', telepon: brand.phone ?? '', paket: selectedPackage?.name ?? '', harga: selectedPackage?.price ?? '',
    dp: selectedPackage?.dp ?? '', airline: selectedPackage?.airline ?? '', hotel: [selectedPackage?.hotelMakkah, selectedPackage?.hotelMadinah].filter(Boolean).join(' / '),
    hotel_makkah: selectedPackage?.hotelMakkah ?? '', hotel_madinah: selectedPackage?.hotelMadinah ?? '', duration: selectedPackage?.duration ?? '',
    durasi: selectedPackage?.duration ?? '', keberangkatan: selectedPackage?.departureDate?.toLocaleDateString('id-ID') ?? selectedPackage?.departureInfo ?? '', highlights: selectedPackage?.highlights ?? '',
  };
  res.json({ success: true, data: { variables, categories: Object.fromEntries(data.map(([key, value]) => [key, transformScriptTree(value, variables)])) } });
}));

scriptsRouter.get('/lms', asyncHandler(async (_req, res) => {
  const file = path.resolve(process.cwd(), '../../packages/scripts-data/conversion-chat/conversion-cycle.json');
  res.json({ success: true, data: transformScriptTree(JSON.parse(await readFile(file, 'utf8')), {}) });
}));
