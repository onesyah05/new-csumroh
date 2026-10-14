import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { isWonStatus } from '@csumroh/shared-types';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { authGuard, requireRole, scopedBrandId } from '../../middleware/auth.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { visibleProspectWhere } from '../chat/device-scope.js';
import { canActOnProspect, linkedProspectIds } from '../prospects/pic.js';
import { buildScriptContext } from '../scripts/context.js';
import { testConnection } from './provider.js';
import { AI_MODELS, getAiConfig, keyHint, saveAiConfig, settingsBody, type AiConfig } from './settings.js';
import { suggestReplies } from './suggest.service.js';

export const aiRouter = Router();
aiRouter.use(authGuard);

const ALLOWED_ROLES = ['cs', 'admin', 'superadmin'];
const HISTORY_LIMIT = 20;
const WIB_OFFSET_MS = 7 * 3_600_000;

/** Fitur aktif untuk user ini: saklar & kunci dari pengaturan Superadmin, role, dan daftar peserta pilot. */
export function aiAvailableFor(user: { id: number; role: string }, config: AiConfig) {
  if (!config.enabled) return false;
  if (!ALLOWED_ROLES.includes(user.role)) return false;
  return config.pilotUserIds.length === 0 || config.pilotUserIds.includes(user.id);
}

/** Awal hari bisnis (00.00 WIB) untuk batas harian. */
export function startOfBusinessDay(now = new Date()) {
  const wib = new Date(now.getTime() + WIB_OFFSET_MS);
  return new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()) - WIB_OFFSET_MS);
}

const suggestLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.NODE_ENV === 'production' ? 10 : 100,
  keyGenerator: (req: Request) => `ai:${req.user?.id ?? 'anon'}`,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, error: 'Terlalu sering meminta saran. Tunggu sebentar lalu coba lagi.' },
});

aiRouter.get('/status', asyncHandler(async (req, res) => {
  res.json({ success: true, data: { enabled: aiAvailableFor(req.user!, await getAiConfig()) } });
}));

/** Pemakaian bulan berjalan (WIB) untuk dipantau Superadmin terhadap batas belanja Claude Console. */
async function monthUsage(config: AiConfig, now = new Date()) {
  const wib = new Date(now.getTime() + WIB_OFFSET_MS);
  const monthStart = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), 1) - WIB_OFFSET_MS);
  const [total, ai, sums, used] = await Promise.all([
    prisma.aiSuggestion.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.aiSuggestion.count({ where: { createdAt: { gte: monthStart }, source: 'ai' } }),
    prisma.aiSuggestion.groupBy({ by: ['model'], where: { createdAt: { gte: monthStart } }, _sum: { inputTokens: true, outputTokens: true } }),
    prisma.aiSuggestion.count({ where: { createdAt: { gte: monthStart }, action: 'used' } }),
  ]);
  const estimatedUsd = sums.reduce((sum, row) => {
    const price = AI_MODELS[(row.model ?? config.model) as keyof typeof AI_MODELS] ?? AI_MODELS[config.model];
    return sum + ((row._sum.inputTokens ?? 0) * price.inputPerMTok + (row._sum.outputTokens ?? 0) * price.outputPerMTok) / 1_000_000;
  }, 0);
  return { suggestions: total, fromAi: ai, used, estimatedUsd: Math.round(estimatedUsd * 100) / 100 };
}

async function settingsView(config: AiConfig) {
  const updatedBy = config.updatedById ? await prisma.user.findUnique({ where: { id: config.updatedById }, select: { name: true } }) : null;
  return {
    enabled: config.enabled,
    hasApiKey: Boolean(config.apiKey),
    apiKeyHint: keyHint(config.apiKey),
    model: config.model,
    models: Object.entries(AI_MODELS).map(([value, item]) => ({ value, label: item.label })),
    pilotUserIds: config.pilotUserIds,
    dailyLimitPerUser: config.dailyLimitPerUser,
    updatedAt: config.updatedAt,
    updatedBy: updatedBy?.name ?? null,
    usage: await monthUsage(config),
  };
}

// Pengaturan Asisten AI hanya untuk Superadmin; kunci API tidak pernah dikirim balik ke browser.
aiRouter.get('/settings', requireRole('superadmin'), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await settingsView(await getAiConfig()) });
}));

aiRouter.put('/settings', requireRole('superadmin'), asyncHandler(async (req, res) => {
  const config = await saveAiConfig(settingsBody.parse(req.body ?? {}), req.user!.id);
  res.json({ success: true, data: await settingsView(config) });
}));

const testBody = z.object({ apiKey: z.string().trim().min(20).max(300).optional(), model: settingsBody.shape.model.optional() });
aiRouter.post('/settings/test', requireRole('superadmin'), asyncHandler(async (req, res) => {
  const body = testBody.parse(req.body ?? {});
  const config = await getAiConfig();
  const apiKey = body.apiKey ?? config.apiKey;
  if (!apiKey) throw new HttpError(422, 'Isi kunci API dulu.');
  res.json({ success: true, data: await testConnection(apiKey, body.model ?? config.model) });
}));

const suggestBody = z.object({
  prospectId: z.coerce.number().int().positive(),
  brandId: z.coerce.number().int().positive().optional(),
  instruction: z.string().trim().max(200).optional().transform((value) => value || null),
  previousSuggestionId: z.coerce.number().int().positive().optional(),
});

aiRouter.post('/reply-suggestions', suggestLimiter, asyncHandler(async (req, res) => {
  const user = req.user!;
  const config = await getAiConfig();
  if (!config.enabled) throw new HttpError(503, 'Saran AI sedang dimatikan.');
  if (!aiAvailableFor(user, config)) throw new HttpError(403, 'Saran AI belum tersedia untuk akun ini.');
  const body = suggestBody.parse(req.body ?? {});
  const brandId = scopedBrandId(req, body.brandId);

  // Prospek harus di brand ini dan di device WhatsApp yang sedang tersambung, sama dengan Inbox.
  const prospect = await prisma.prospect.findFirst({ where: { AND: [{ id: body.prospectId, brandId }, await visibleProspectWhere([brandId])] } });
  if (!prospect) throw new HttpError(404, 'Prospek tidak ditemukan di brand ini.');
  if (!canActOnProspect(user, prospect)) throw new HttpError(403, 'Hanya PIC prospek ini atau Admin yang dapat meminta saran.');
  if (isWonStatus(prospect.status)) throw new HttpError(409, 'Prospek sudah deal.');

  const dayStart = startOfBusinessDay();
  const used = await prisma.aiSuggestion.count({ where: { userId: user.id, createdAt: { gte: dayStart } } });
  if (used >= config.dailyLimitPerUser) throw new HttpError(429, 'Batas saran AI hari ini sudah tercapai.');
  // Plafon biaya seluruh tim: hanya permintaan yang benar-benar memanggil penyedia AI yang dihitung.
  const usedByTeam = await prisma.aiSuggestion.count({ where: { source: 'ai', createdAt: { gte: dayStart } } });
  if (usedByTeam >= env.AI_DAILY_LIMIT_GLOBAL) throw new HttpError(429, 'Batas saran AI harian untuk seluruh tim sudah tercapai. Coba lagi besok.');

  const ids = await linkedProspectIds(prisma, prospect);
  const rows = await prisma.chatMessage.findMany({
    where: {
      brandId,
      prospectId: { in: ids },
      isDeleted: false,
      messageType: { notIn: ['protocolMessage', 'reactionMessage'] },
      ...(prospect.devicePhone ? { devicePhone: prospect.devicePhone } : {}),
    },
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    take: HISTORY_LIMIT,
    select: { isFromMe: true, messageType: true, messageText: true },
  });
  const messages = rows.reverse();
  if (!messages.some((row) => !row.isFromMe)) throw new HttpError(409, 'Belum ada pesan dari prospek untuk dibalas.');

  const [brand, pkg] = await Promise.all([
    prisma.brand.findUniqueOrThrow({ where: { id: brandId } }),
    prospect.packageId ? prisma.package.findFirst({ where: { id: prospect.packageId, brandId } }) : null,
  ]);
  const context = buildScriptContext({ csName: user.name, brand, pkg, prospect });

  const started = Date.now();
  const result = await suggestReplies({
    csName: user.name, brandName: brand.name, context, prospect, messages, instruction: body.instruction,
  });
  const latencyMs = Date.now() - started;

  const log = await prisma.aiSuggestion.create({
    data: {
      brandId, prospectId: prospect.id, userId: user.id, previousId: body.previousSuggestionId ?? null,
      source: result.source, fallbackReason: result.fallbackReason, model: result.model,
      intent: result.detected?.intent ?? null, objection: result.detected?.objection ?? null, coverage: result.detected?.coverage ?? null,
      // Hanya template (token, tanpa nilai data) dan status; teks final dan riwayat chat tidak disimpan.
      options: result.options.map(({ approach, origin, template, status }) => ({ approach, origin, template, status })),
      instruction: body.instruction, inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs,
    },
  });

  res.json({
    success: true,
    data: {
      suggestionId: log.id,
      source: result.source,
      detected: result.detected,
      options: result.options,
      warnings: context.warnings,
      contextVersion: context.version,
    },
  });
}));

const feedbackBody = z.object({
  action: z.enum(['used', 'dismissed', 'regenerated']),
  optionIndex: z.coerce.number().int().min(0).max(2).optional(),
  similarity: z.coerce.number().min(0).max(1).optional(),
});

aiRouter.post('/reply-suggestions/:id/feedback', asyncHandler(async (req, res) => {
  const body = feedbackBody.parse(req.body ?? {});
  const suggestion = await prisma.aiSuggestion.findFirst({ where: { id: Number(req.params.id), userId: req.user!.id } });
  if (!suggestion) throw new HttpError(404, 'Saran tidak ditemukan.');
  await prisma.aiSuggestion.update({
    where: { id: suggestion.id },
    data: { action: body.action, optionIndex: body.optionIndex ?? null, similarity: body.similarity ?? null, actedAt: new Date() },
  });
  res.json({ success: true });
}));
