import { interpolateScript, normalizeScriptNarrative, objectionLabel, OBJECTION_SCRIPT_CATEGORIES, PROSPECT_STATUS_LABELS, recommendedCategory, transformScriptTree } from '@csumroh/shared-types';
import { z } from 'zod';
import { annotateScript, TOKEN_INFO, type ScriptContext } from '../scripts/context.js';
import { readScript } from '../scripts/scripts.routes.js';
import { ALLOWED_TOKENS, redactPii, templateViolations } from './guard.js';
import { buildMaterial, buildUserContent, INTENTS, OBJECTIONS, ORIGINS, OUTPUT_SCHEMA, SYSTEM_PROMPT, type CategoryMaterial } from './prompt.js';
import { getProvider, ProviderError, type FallbackReason } from './provider.js';

const MEDIA_LABEL: Record<string, string> = {
  imageMessage: '[gambar]', videoMessage: '[video]', audioMessage: '[pesan suara]', documentMessage: '[dokumen]',
  documentWithCaptionMessage: '[dokumen]', stickerMessage: '[stiker]', locationMessage: '[lokasi]', contactMessage: '[kontak]',
};
const MAX_MESSAGE_CHARS = 1000;
const MAX_OPTIONS = 3;

export type ChatLine = { isFromMe: boolean; messageType: string; messageText: string | null };
/** Riwayat chat untuk prompt: teks disamarkan, media diganti label, pesan kosong dibuang (spec bagian 7). */
export function promptMessages(rows: ChatLine[]) {
  return rows.flatMap((row) => {
    const text = row.messageText?.trim();
    const media = MEDIA_LABEL[row.messageType];
    const body = [media, text ? redactPii(text).slice(0, MAX_MESSAGE_CHARS) : null].filter(Boolean).join(' ');
    return body ? [{ fromCs: row.isFromMe, text: body }] : [];
  });
}

const OutputSchema = z.object({
  intent: z.enum(INTENTS),
  objection: z.enum(OBJECTIONS),
  coverage: z.enum(['bank', 'partial', 'none']),
  needs_internal_info: z.boolean(),
  options: z.array(z.object({ approach: z.string(), origin: z.enum(ORIGINS), template: z.string() })),
});

export type SuggestionOption = {
  approach: string; origin: (typeof ORIGINS)[number] | 'bank'; template: string; text: string;
  status: 'ready' | 'needs_context' | 'blocked'; reasons: string[]; missing: Array<{ token: string; label: string; kind: string }>;
};
export type SuggestionResult = {
  source: 'ai' | 'fallback';
  fallbackReason: FallbackReason | null;
  detected: { intent: string; objection: string | null; coverage: string; needsInternalInfo: boolean; stageLabel: string } | null;
  options: SuggestionOption[];
  model: string | null; inputTokens: number | null; outputTokens: number | null;
};

type Input = {
  csName: string; brandName: string; context: ScriptContext;
  prospect: { name: string; status: string; objectionCategory: string | null; objectionNotes: string | null };
  messages: ChatLine[];
  instruction: string | null;
};

/** Teks opsi + status pakai dengan aturan yang sama dengan pustaka script. */
function finishOption(context: ScriptContext, option: { approach: string; origin: SuggestionOption['origin']; template: string }): SuggestionOption {
  const text = interpolateScript(option.template, context.variables);
  const annotated = annotateScript({ script: text }, context);
  return { ...option, text, status: annotated.status, reasons: annotated.reasons, missing: annotated.missing };
}

/** Script bank kategori ini (template mentah, belum diisi) yang bisa dipakai untuk prospek, siap lebih dulu. */
async function bankScripts(category: string, context: ScriptContext, objectionCategory: string | null) {
  const raw = await readScript(category);
  const focus = category === 'objection' && objectionCategory ? OBJECTION_SCRIPT_CATEGORIES[objectionCategory] : undefined;
  const rank = { ready: 0, needs_context: 1, blocked: 2 } as const;
  const scripts = (raw.scripts ?? [])
    .filter((item: any) => item?.script && !item.when)
    .filter((item: any) => !focus || focus.includes(item.category))
    .map((item: any) => {
      const rendered = transformScriptTree(item.script as string, context.variables);
      const status = annotateScript({ script: rendered, audience: item.audience }, context).status as keyof typeof rank;
      return { title: String(item.title ?? item.id), useWhen: item.use_when as string | undefined, template: normalizeScriptNarrative(item.script as string), status };
    })
    .filter((item: { status: string }) => item.status !== 'blocked')
    .sort((a: { status: keyof typeof rank }, b: { status: keyof typeof rank }) => rank[a.status] - rank[b.status]);
  return { data: raw, scripts: scripts as Array<{ title: string; useWhen?: string; template: string }> };
}

export async function suggestReplies(input: Input): Promise<SuggestionResult> {
  const { context } = input;
  const category = recommendedCategory(input.prospect.status);
  const bank = await bankScripts(category, context, input.prospect.objectionCategory);
  const stageLabel = PROSPECT_STATUS_LABELS[input.prospect.status] ?? input.prospect.status;

  const fallback = (reason: FallbackReason): SuggestionResult => ({
    source: 'fallback', fallbackReason: reason, detected: null,
    options: bank.scripts.slice(0, MAX_OPTIONS).map((item) => finishOption(context, { approach: item.title, origin: 'bank', template: item.template })),
    model: null, inputTokens: null, outputTokens: null,
  });

  const material: CategoryMaterial = { category, data: bank.data, examples: bank.scripts.slice(0, MAX_OPTIONS).map((item) => ({ title: item.title, useWhen: item.useWhen, text: item.template })) };
  const tokens = [...ALLOWED_TOKENS];
  const profile: Record<string, string> = {};
  for (const key of ['jumlah_jamaah', 'bulan_target', 'budget', 'kota'] as const) {
    if (context.variables[key]) profile[TOKEN_INFO[key]?.label ?? key] = context.variables[key]!;
  }
  const messages = promptMessages(input.messages);
  const history = messages.map((m) => m.text).join('\n');
  // Alamat/Maps yang sudah dikirim CS tidak ditawarkan lagi (perbaikan C).
  const csText = messages.filter((m) => m.fromCs).map((m) => m.text.toLowerCase()).join('\n');
  const address = context.variables.alamat_kantor?.toLowerCase().slice(0, 25);
  const blockedTokens = [
    ...(address && csText.includes(address) ? ['alamat_kantor'] : []),
    ...(/maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps/.test(csText) ? ['link_maps'] : []),
  ];
  const usable = (token: string) => !blockedTokens.includes(token) && (Boolean(context.variables[token]) || token === 'travel' || token === 'cs_name');
  const baseUser = buildUserContent({
    csName: input.csName,
    brandName: input.brandName,
    prospect: {
      firstName: input.prospect.name.trim().split(/\s+/)[0] || 'Bapak/Ibu',
      stageLabel,
      objection: input.prospect.objectionCategory ? objectionLabel(input.prospect.objectionCategory) : null,
      objectionNotes: input.prospect.objectionNotes ? redactPii(input.prospect.objectionNotes).slice(0, 300) : null,
      profile,
    },
    packageName: context.variables.paket ?? null,
    available: tokens.filter(usable),
    missing: tokens.filter((token) => !usable(token)),
    warnings: context.warnings,
    messages,
    instruction: input.instruction,
  });

  let provider;
  try {
    provider = await getProvider();
  } catch (error) {
    return fallback(error instanceof ProviderError ? error.reason : 'provider_error');
  }
  let user = baseUser;
  let inputTokens = 0;
  let outputTokens = 0;
  // Satu percobaan ulang dengan koreksi bila semua opsi melanggar aturan (spec bagian 8).
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let result;
    try {
      result = await provider.generate({ system: SYSTEM_PROMPT, material: buildMaterial(material), user, schema: OUTPUT_SCHEMA });
    } catch (error) {
      return { ...fallback(error instanceof ProviderError ? error.reason : 'provider_error'), inputTokens: inputTokens || null, outputTokens: outputTokens || null };
    }
    inputTokens += result.inputTokens;
    outputTokens += result.outputTokens;
    const parsed = OutputSchema.safeParse(result.json);
    const candidates = parsed.success ? parsed.data.options.slice(0, MAX_OPTIONS) : [];
    const checked = candidates.map((option) => ({ option, violations: templateViolations(option.template, { history, blockedTokens }) }));
    const valid = checked.filter((item) => !item.violations.length);
    if (parsed.success && valid.length) {
      const out = parsed.data;
      return {
        source: 'ai', fallbackReason: null,
        detected: { intent: out.intent, objection: out.objection === 'none' ? null : out.objection, coverage: out.coverage, needsInternalInfo: out.needs_internal_info, stageLabel },
        options: valid.map(({ option }) => finishOption(context, { approach: option.approach.slice(0, 40), origin: option.origin, template: option.template.trim() })),
        model: result.model, inputTokens, outputTokens,
      };
    }
    const problems = result.json === undefined
      ? 'jawaban bukan JSON yang valid; balas hanya dengan JSON sesuai skema'
      : parsed.success
        ? [...new Set(checked.flatMap((item) => item.violations))].join('; ')
        : 'format jawaban tidak sesuai skema';
    user = `${baseUser}\n\nPercobaan sebelumnya ditolak karena: ${problems}. Perbaiki: fakta hanya lewat token yang tersedia atau angka yang tertulis persis di riwayat chat.`;
  }
  return { ...fallback('invalid_output'), inputTokens, outputTokens };
}
