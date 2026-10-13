import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../utils/http.js';
import { decryptSecret, encryptSecret } from '../capi/meta-token.js';

/** Model yang boleh dipilih Superadmin, beserta harga per 1 juta token (USD, prompt ≤100K) untuk estimasi biaya. */
export const AI_MODELS = {
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5 (hemat, cepat)', inputPerMTok: 0.1, outputPerMTok: 0.5 },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5 (lebih pintar, ±20× lebih mahal)', inputPerMTok: 2, outputPerMTok: 10 },
} as const;
export type AiModel = keyof typeof AI_MODELS;
export const DEFAULT_MODEL: AiModel = 'claude-haiku-5-5';

export type AiConfig = { enabled: boolean; apiKey: string | null; model: AiModel; pilotUserIds: number[]; dailyLimitPerUser: number; updatedById: number | null; updatedAt: Date | null };

const ids = (value: unknown) => (Array.isArray(value) ? value.map(Number).filter((id) => Number.isInteger(id) && id > 0) : []);
const modelOf = (value: string): AiModel => (value in AI_MODELS ? (value as AiModel) : DEFAULT_MODEL);

// Dibaca di setiap permintaan saran; cache singkat agar tidak menambah query, dikosongkan saat disimpan.
const CACHE_MS = 30_000;
let cache: { at: number; config: AiConfig } | null = null;

export async function getAiConfig(): Promise<AiConfig> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.config;
  const row = await prisma.aiSetting.findUnique({ where: { id: 1 } });
  let apiKey: string | null = null;
  if (row?.apiKey) {
    try {
      apiKey = decryptSecret(row.apiKey);
    } catch {
      // Kunci enkripsi server berubah: kunci lama tidak terbaca, Superadmin perlu memasukkan ulang.
      apiKey = null;
    }
  }
  const config: AiConfig = {
    enabled: Boolean(row?.enabled && apiKey),
    apiKey,
    model: modelOf(row?.model ?? DEFAULT_MODEL),
    pilotUserIds: ids(row?.pilotUserIds),
    dailyLimitPerUser: row?.dailyLimitPerUser ?? 150,
    updatedById: row?.updatedById ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
  cache = { at: Date.now(), config };
  return config;
}
export function clearAiConfigCache() { cache = null; }

/** Kunci tidak pernah dikirim balik ke browser; hanya 4 karakter terakhir untuk dikenali. */
export const keyHint = (apiKey: string | null) => (apiKey ? `…${apiKey.slice(-4)}` : null);

export const settingsBody = z.object({
  enabled: z.boolean(),
  // Diisi = ganti kunci; tidak dikirim = kunci lama tetap; null = hapus kunci.
  apiKey: z.string().trim().min(20, 'Kunci API tidak valid.').max(300).nullable().optional(),
  model: z.enum(Object.keys(AI_MODELS) as [AiModel, ...AiModel[]]),
  pilotUserIds: z.array(z.number().int().positive()).max(200),
  dailyLimitPerUser: z.number().int().min(1).max(2000),
});

export async function saveAiConfig(input: z.infer<typeof settingsBody>, userId: number) {
  const current = await getAiConfig();
  const nextKey = input.apiKey === undefined ? current.apiKey : input.apiKey;
  if (input.enabled && !nextKey) throw new HttpError(422, 'Isi kunci API sebelum mengaktifkan Asisten AI.');
  const data = {
    enabled: input.enabled,
    model: input.model,
    pilotUserIds: [...new Set(input.pilotUserIds)],
    dailyLimitPerUser: input.dailyLimitPerUser,
    updatedById: userId,
    ...(input.apiKey !== undefined ? { apiKey: input.apiKey ? encryptSecret(input.apiKey) : null } : {}),
  };
  await prisma.aiSetting.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
  clearAiConfigCache();
  return getAiConfig();
}
