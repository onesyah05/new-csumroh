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

function normalizeScriptData(file: string, raw: any) {
  if (!raw || !Array.isArray(raw.scripts)) return raw;

  const npgdMap: Record<string, { code: string; label: string; name: string; desc: string }> = {
    need: { code: 'need', label: 'Need', name: 'Need', desc: 'Kebutuhan' },
    pain: { code: 'pain', label: 'Pain', name: 'Pain', desc: 'Kendala' },
    gain: { code: 'gain', label: 'Gain', name: 'Gain', desc: 'Manfaat' },
    dream: { code: 'dream', label: 'Dream', name: 'Dream', desc: 'Impian' },
    qualification: { code: 'qualification', label: 'Kualifikasi', name: 'Kualifikasi', desc: 'Info Praktis' },
    combination: { code: 'combination', label: 'Kombinasi', name: 'Kombinasi', desc: 'Terpadu' },
    transition: { code: 'transition', label: 'Transisi', name: 'Transisi', desc: 'Penawaran' },
  };

  const normalizedScripts = raw.scripts.map((item: any) => {
    const copy = { ...item };

    // Objection format: uses 'tgjp' object instead of flat 'script'
    if (!copy.script && copy.tgjp) {
      const tgjp = copy.tgjp;
      const parts: string[] = [];

      const terima = tgjp.terima;
      if (terima && (Array.isArray(terima) ? terima.length : true)) {
        parts.push('🤝 *Terima:*\n' + (Array.isArray(terima) ? terima[0] : terima));
      }

      const gali = tgjp.gali;
      if (gali && (Array.isArray(gali) ? gali.length : true)) {
        parts.push('🔍 *Gali:*\n' + (Array.isArray(gali) ? gali[0] : gali));
      }

      const jawab = tgjp.jawab;
      if (Array.isArray(jawab)) {
        for (const j of jawab) {
          if (j?.script) {
            parts.push('💬 *Jawab:*\n' + j.script);
            break;
          }
        }
      }

      const pastikan = tgjp.pastikan;
      if (pastikan && (Array.isArray(pastikan) ? pastikan.length : true)) {
        parts.push('✅ *Pastikan:*\n' + (Array.isArray(pastikan) ? pastikan[0] : pastikan));
      }

      copy.script = parts.join('\n\n');
      copy.use_when = (copy.prospect_examples ?? []).slice(0, 2).join(' / ');

      const steps: Array<{ label: string; name: string; text: string }> = [];
      if (terima && (Array.isArray(terima) ? terima.length : true)) {
        steps.push({ label: 'T', name: 'Terima', text: Array.isArray(terima) ? terima[0] : terima });
      }
      if (gali && (Array.isArray(gali) ? gali.length : true)) {
        steps.push({ label: 'G', name: 'Gali', text: Array.isArray(gali) ? gali[0] : gali });
      }
      if (Array.isArray(jawab)) {
        for (const j of jawab) {
          if (j?.script) {
            steps.push({ label: 'J', name: 'Jawab', text: j.script });
            break;
          }
        }
      }
      if (pastikan && (Array.isArray(pastikan) ? pastikan.length : true)) {
        steps.push({ label: 'P', name: 'Pastikan', text: Array.isArray(pastikan) ? pastikan[0] : pastikan });
      }
      copy.steps = steps;
    }

    // NPGD framework mapping for identification scripts
    if (file === 'identification') {
      const cat = String(copy.category ?? '').toLowerCase();
      copy.npgd = npgdMap[cat] ?? null;
    }

    // POV transform: agent -> CS (matching csumroh/api/scripts.php)
    if (copy.script) {
      copy.script = copy.script
        .replaceAll('{{agent_name}}', '{{cs_name}}')
        .replaceAll('mitra agen', 'tim CS')
        .replaceAll('Mitra Agen', 'Tim CS');
    }
    if (copy.use_when) {
      copy.use_when = copy.use_when
        .replaceAll('Agen ', 'CS ')
        .replaceAll('agen ', 'cs ');
    }
    if (Array.isArray(copy.steps)) {
      copy.steps = copy.steps.map((step: any) => ({
        ...step,
        text: String(step.text ?? '')
          .replaceAll('{{agent_name}}', '{{cs_name}}')
          .replaceAll('mitra agen', 'tim CS')
          .replaceAll('Mitra Agen', 'Tim CS'),
      }));
    }

    return copy;
  });

  return { ...raw, scripts: normalizedScripts };
}

function formatRupiah(val: any): string {
  if (!val && val !== 0) return '';
  const clean = String(val).replace(/[^\d]/g, '');
  return clean ? 'Rp ' + Number(clean).toLocaleString('id-ID') : String(val);
}

async function readScript(name: string) {
  const file = path.resolve(process.cwd(), '../../packages/scripts-data/scripts-chat', `${name}.json`);
  const raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
  return normalizeScriptData(name, raw);
}

scriptsRouter.get('/', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const [brand, selectedPackage, data] = await Promise.all([
    prisma.brand.findUniqueOrThrow({ where: { id: brandId } }),
    req.query.packageId ? prisma.package.findFirst({ where: { id: Number(req.query.packageId), brandId } }) : null,
    Promise.all(categories.map(async (category) => [category, await readScript(category)] as const)),
  ]);

  const rawName = String(req.query.nama ?? '').trim();
  const firstName = rawName.split(' ')[0] || rawName || 'Kak';
  const customerName = rawName || 'Bapak/Ibu';

  const hotelList = [selectedPackage?.hotelMakkah, selectedPackage?.hotelMadinah].filter(Boolean);
  const hotel = hotelList.length > 0 ? hotelList.join(' & ') : 'hotel bintang sesuai paket';
  const jarakHotel = selectedPackage?.hotelMakkah ? 'jarak akomodasi tertera pada rincian brosur paket' : 'informasi akomodasi tertera pada paket';
  const airline = selectedPackage?.airline || 'maskapai resmi sesuai rincian paket';
  const departure = selectedPackage?.departureDate?.toLocaleDateString('id-ID') ?? selectedPackage?.departureInfo ?? 'jadwal keberangkatan resmi';
  const duration = selectedPackage?.duration || 'Sesuai durasi paket';
  const highlights = selectedPackage?.highlights || selectedPackage?.facilitiesIncluded || 'akomodasi, visa umroh, pembimbing ibadah, dan perlengkapan';
  const ppiu = brand.ppiuNumber && brand.ppiuNumber !== '-' ? brand.ppiuNumber : `Izin PPIU ${brand.name}`;

  const variables = {
    nama: customerName,
    cs_name: req.user!.name,
    agent_name: req.user!.name,
    travel: brand.name,
    ppiu,
    bank: brand.bankName ?? `Bank Rekening Resmi ${brand.name}`,
    rekening: brand.bankAccountNumber ?? '-',
    nama_rekening: brand.bankAccountHolder ?? brand.name,
    alamat: brand.address ?? '',
    telepon: brand.phone ?? '',
    paket: selectedPackage?.name ?? 'Paket Umroh Pilihan',
    harga: formatRupiah(selectedPackage?.price) || 'harga resmi katalog',
    dp: formatRupiah(selectedPackage?.dp) || 'DP resmi paket',
    airline,
    maskapai: airline,
    hotel,
    jarak_hotel: jarakHotel,
    hotel_makkah: selectedPackage?.hotelMakkah ?? '',
    hotel_madinah: selectedPackage?.hotelMadinah ?? '',
    duration,
    durasi: duration,
    keberangkatan: departure,
    tanggal: departure,
    highlights,
    fasilitas_utama: highlights,
    jumlah_jamaah: 'Kakak dan keluarga',
    bulan: new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }),
    deadline: 'besok pukul 17:00 WIB',
    seat: 'sisa 4 seat lagi',
    promo: 'free perlengkapan eksklusif & handling bandara',
    budget: 'anggaran yang sesuai',
    nama_pendamping: 'keluarga tercinta',
    followup_date: 'jadwal yang ditentukan',
    kota: 'Jakarta',
    sumber: 'WhatsApp resmi',
  };
  res.json({ success: true, data: { variables, categories: Object.fromEntries(data.map(([key, value]) => [key, transformScriptTree(value, variables)])) } });
}));

scriptsRouter.get('/lms', asyncHandler(async (_req, res) => {
  const file = path.resolve(process.cwd(), '../../packages/scripts-data/conversion-chat/conversion-cycle.json');
  res.json({ success: true, data: transformScriptTree(JSON.parse(await readFile(file, 'utf8')), {}) });
}));
