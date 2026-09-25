import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { transformScriptTree } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { authGuard, scopedBrandId } from '../../middleware/auth.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { annotateScript, buildScriptContext } from './context.js';

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

    // Keberatan (TGJP): tiap langkah menyimpan semua variasinya. Langkah Jawab dipilih berdasarkan ALASAN yang
    // ditemukan saat menggali (audit S08), bukan otomatis cabang pertama.
    if (!copy.script && copy.tgjp) {
      const tgjp = copy.tgjp;
      const list = (value: unknown) => (Array.isArray(value) ? value : value ? [value] : []).map(String).filter(Boolean);
      const steps: Array<{ label: string; name: string; text: string; choose?: 'reason'; variants: Array<{ reason?: string; label: string; text: string }> }> = [];
      const terima = list(tgjp.terima);
      const gali = list(tgjp.gali);
      const pastikan = list(tgjp.pastikan);
      const jawab = (Array.isArray(tgjp.jawab) ? tgjp.jawab : []).filter((item: any) => item?.script);
      if (terima.length) steps.push({ label: 'T', name: 'Terima', text: terima[0]!, variants: terima.map((text, i) => ({ label: `Variasi ${i + 1}`, text })) });
      if (gali.length) steps.push({ label: 'G', name: 'Gali', text: gali[0]!, variants: gali.map((text, i) => ({ label: `Pertanyaan ${i + 1}`, text })) });
      if (jawab.length) {
        steps.push({
          label: 'J', name: 'Jawab', text: '', choose: 'reason',
          variants: jawab.map((item: any) => ({ reason: item.reason, label: item.label || String(item.reason).replaceAll('_', ' '), text: item.script })),
        });
      }
      if (pastikan.length) steps.push({ label: 'P', name: 'Pastikan', text: pastikan[0]!, variants: pastikan.map((text, i) => ({ label: `Variasi ${i + 1}`, text })) });
      copy.steps = steps;
      // Teks gabungan hanya untuk pencarian; tidak dipakai sebagai satu pesan.
      copy.script = [terima[0], gali[0], pastikan[0]].filter(Boolean).join('\n\n');
      copy.use_when = (copy.prospect_examples ?? []).slice(0, 2).join(' / ');
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
    // Naskah arsip (belum disahkan holding) tidak dikirim ke CS.
    if (copy.status === 'archived') return null;

    return copy;
  });

  return { ...raw, scripts: normalizedScripts.filter(Boolean) };
}

async function readScript(name: string) {
  const file = path.resolve(process.cwd(), '../../packages/scripts-data/scripts-chat', `${name}.json`);
  const raw = JSON.parse(await readFile(file, 'utf8'));
  // Shared prompts for the qualification form and Copilot; preserve the legacy library.
  if (name === 'identification') {
    const promptsFile = path.resolve(process.cwd(), '../../packages/scripts-data/scripts-chat/qualification-prompts.json');
    const prompts = JSON.parse(await readFile(promptsFile, 'utf8'));
    raw.scripts = [...prompts.scripts, ...raw.scripts];
  }
  return normalizeScriptData(name, raw);
}

/**
 * Pustaka script dengan konteks prospek (audit S01). Prospek dan paket dibaca dari server dalam brand yang
 * berhak diakses; client hanya mengirim id. Setiap script dilengkapi status pakai dan data yang kurang (S12, S15).
 */
scriptsRouter.get('/', asyncHandler(async (req, res) => {
  const brandId = scopedBrandId(req, req.query.brandId ? Number(req.query.brandId) : undefined);
  const prospectId = Number(req.query.prospectId) || null;
  const [brand, prospect, data] = await Promise.all([
    prisma.brand.findUniqueOrThrow({ where: { id: brandId } }),
    prospectId ? prisma.prospect.findFirst({ where: { id: prospectId, brandId } }) : null,
    Promise.all(categories.map(async (category) => [category, await readScript(category)] as const)),
  ]);
  if (prospectId && !prospect) throw new HttpError(404, 'Prospek tidak ditemukan di brand ini.');
  // Paket mengikuti data prospek; packageId dari query hanya untuk pratinjau tanpa prospek.
  const packageId = prospect ? prospect.packageId : Number(req.query.packageId) || null;
  const pkg = packageId ? await prisma.package.findFirst({ where: { id: packageId, brandId } }) : null;

  const context = buildScriptContext({ csName: req.user!.name, brand, pkg, prospect });
  const categoriesOut = Object.fromEntries(data.map(([key, value]) => {
    const rendered = transformScriptTree(value, context.variables);
    return [key, { ...rendered, scripts: (rendered.scripts ?? []).map((script: any) => annotateScript(script, context)) }];
  }));
  res.json({
    success: true,
    data: {
      variables: context.variables,
      context: { prospectId, packageId: pkg?.id ?? null, warnings: context.warnings, version: context.version, state: context.state },
      categories: categoriesOut,
    },
  });
}));

scriptsRouter.get('/lms', asyncHandler(async (_req, res) => {
  const file = path.resolve(process.cwd(), '../../packages/scripts-data/conversion-chat/conversion-cycle.json');
  res.json({ success: true, data: transformScriptTree(JSON.parse(await readFile(file, 'utf8')), {}) });
}));
