import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { getAiConfig } from './settings.js';

export type ProviderRequest = {
  /** Instruksi statis (di-cache provider). */
  system: string;
  /** Bahan kategori script; stabil per kategori, ikut di-cache setelah instruksi. */
  material: string;
  /** Konteks prospek + riwayat chat; berubah tiap permintaan. */
  user: string;
  schema: Record<string, unknown>;
};
export type ProviderResult = { json: unknown; model: string; inputTokens: number; outputTokens: number };
export type FallbackReason = 'timeout' | 'provider_error' | 'refusal' | 'truncated' | 'invalid_output' | 'not_configured';

export class ProviderError extends Error {
  constructor(public reason: FallbackReason, message: string) { super(message); }
}

export interface AiProvider {
  generate(request: ProviderRequest): Promise<ProviderResult>;
}

// Effort rendah cukup untuk draf chat dan menekan biaya; bisa dinaikkan bila uji model menunjukkan perlu.
const EFFORT = 'low' as const;

/** Pesan yang dipahami Superadmin untuk kegagalan dari Claude API (tanpa membocorkan isi kunci). */
export function describeApiError(error: unknown) {
  if (error instanceof Anthropic.AuthenticationError) return 'Kunci API ditolak. Periksa kembali kunci dari Claude Console.';
  if (error instanceof Anthropic.PermissionDeniedError) return 'Kunci API tidak punya izin untuk model ini.';
  if (error instanceof Anthropic.RateLimitError) return 'Batas pemakaian atau kredit Claude API tercapai.';
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'Claude API tidak merespons tepat waktu.';
  if (error instanceof Anthropic.APIError) return `Claude API error ${error.status ?? ''}: ${error.message}`.trim();
  return 'Claude API tidak dapat dihubungi.';
}

/** Claude API langsung (spec bagian 2). Retry SDK dimatikan: gagal sekali langsung fallback agar CS tidak menunggu. */
export function anthropicProvider(apiKey: string, model: string): AiProvider {
  const client = new Anthropic({ apiKey, timeout: env.AI_TIMEOUT_MS, maxRetries: 0 });
  return {
    async generate(request) {
      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model,
          // Token thinking ikut dihitung; batas terlalu kecil memotong jawaban setelah blok thinking.
          max_tokens: 4000,
          system: [
            { type: 'text', text: request.system },
            { type: 'text', text: request.material, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: request.user }],
          output_config: { effort: EFFORT, format: { type: 'json_schema', schema: request.schema } },
        });
      } catch (error) {
        if (error instanceof Anthropic.APIConnectionTimeoutError) throw new ProviderError('timeout', describeApiError(error));
        throw new ProviderError('provider_error', describeApiError(error));
      }
      if (response.stop_reason === 'refusal') throw new ProviderError('refusal', 'Provider AI menolak permintaan.');
      if (response.stop_reason === 'max_tokens') throw new ProviderError('truncated', 'Jawaban AI terpotong.');
      const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new ProviderError('invalid_output', 'Jawaban AI bukan JSON.');
      }
      const usage = response.usage;
      return {
        json,
        model: response.model,
        inputTokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
        outputTokens: usage.output_tokens,
      };
    },
  };
}

/** Uji kunci dan model dari halaman pengaturan dengan permintaan sangat kecil. */
export async function testConnection(apiKey: string, model: string) {
  const client = new Anthropic({ apiKey, timeout: env.AI_TIMEOUT_MS, maxRetries: 0 });
  const started = Date.now();
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1000,
      messages: [{ role: 'user', content: 'Balas satu kata saja: OK' }],
      output_config: { effort: EFFORT },
    });
    if (response.stop_reason === 'refusal') return { ok: false as const, message: 'Model menolak permintaan uji.' };
    return { ok: true as const, model: response.model, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false as const, message: describeApiError(error) };
  }
}

let cached: { key: string; provider: AiProvider } | null = null;
let override: AiProvider | null = null;
/** Provider sesuai pengaturan Superadmin; dibuat ulang bila kunci atau model berubah. */
export async function getProvider(): Promise<AiProvider> {
  if (override) return override;
  const config = await getAiConfig();
  if (!config.apiKey) throw new ProviderError('not_configured', 'Kunci API Asisten AI belum diisi.');
  const key = `${config.model}:${config.apiKey}`;
  if (cached?.key !== key) cached = { key, provider: anthropicProvider(config.apiKey, config.model) };
  return cached.provider;
}
/** Hanya untuk tes: ganti provider dengan versi palsu. */
export function setProviderForTests(provider: AiProvider | null) { override = provider; }
