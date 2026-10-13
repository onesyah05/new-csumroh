import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/button';
import { WhatsAppText } from './WhatsAppText';
import type { ScriptGap, ScriptStatus } from './scriptLibrary';

export type AiOption = {
  approach: string; origin: 'bank' | 'adapted' | 'generated' | 'holding'; template: string; text: string;
  status: ScriptStatus; reasons: string[]; missing: ScriptGap[];
};
type AiSuggestion = {
  suggestionId: number; source: 'ai' | 'fallback';
  detected: { intent: string; objection: string | null; coverage: string; needsInternalInfo: boolean; stageLabel: string } | null;
  options: AiOption[];
};
/** Opsi yang sedang ditinjau CS; dipakai untuk mencatat apakah saran dipakai dan seberapa banyak diedit. */
export type AiPick = { suggestionId: number; optionIndex: number; text: string };

const ORIGIN_LABEL: Record<AiOption['origin'], string> = {
  bank: 'Dari bank skrip', adapted: 'Adaptasi skrip', generated: 'Disusun AI · cek isinya', holding: 'Balasan penahan',
};
const INTENT_LABEL: Record<string, string> = {
  greeting: 'Sapaan', question_package: 'Tanya paket', question_price: 'Tanya harga', objection: 'Keberatan',
  ready_to_pay: 'Siap bayar', payment_sent: 'Sudah transfer', followup_reply: 'Balasan follow-up', cs_followup: 'Lanjutan dari CS', other: 'Lainnya',
};
const OBJECTION_LABEL: Record<string, string> = {
  harga: 'harga', izin_keluarga: 'izin keluarga', waktu: 'waktu', kepercayaan: 'kepercayaan', jadwal: 'jadwal',
  paspor: 'paspor', fasilitas: 'fasilitas', lainnya: 'lainnya',
};

export function useAiStatus() {
  return useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<{ enabled: boolean }>('/ai/status'), staleTime: 5 * 60_000 });
}

/** Kemiripan kata (Dice) antara saran dan teks yang akhirnya dipakai CS: 1 = tidak diedit. */
export function textSimilarity(a: string, b: string) {
  const words = (text: string) => text.toLocaleLowerCase('id-ID').split(/[^\p{L}\p{N}{}_]+/u).filter(Boolean);
  const left = words(a);
  const right = words(b);
  if (!left.length && !right.length) return 1;
  const counts = new Map<string, number>();
  for (const word of left) counts.set(word, (counts.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of right) {
    const n = counts.get(word) ?? 0;
    if (n > 0) { shared += 1; counts.set(word, n - 1); }
  }
  return Math.round(((2 * shared) / (left.length + right.length)) * 100) / 100;
}

export function sendAiFeedback(suggestionId: number, body: { action: 'used' | 'regenerated'; optionIndex?: number; similarity?: number }) {
  return api.post(`/ai/reply-suggestions/${suggestionId}/feedback`, body).catch(() => undefined);
}

interface Props {
  brandId?: number;
  prospectId: number;
  onReview(option: AiOption, pick: AiPick): void;
}

/** Saran Balasan AI di Copilot: draf dari AI, fakta diisi server dari data paket/prospek, CS tetap yang mengirim. */
export function AiReplySuggestions({ brandId, prospectId, onReview }: Props) {
  const [instruction, setInstruction] = useState('');
  const [result, setResult] = useState<AiSuggestion | null>(null);
  const suggest = useMutation({
    mutationFn: (previous?: number) => api.post<AiSuggestion>('/ai/reply-suggestions', {
      prospectId, brandId, instruction: instruction.trim() || undefined, previousSuggestionId: previous,
    }),
    onSuccess: setResult,
  });
  function request() {
    if (result) void sendAiFeedback(result.suggestionId, { action: 'regenerated' });
    suggest.mutate(result?.suggestionId);
  }

  const detected = result?.detected;
  return <section aria-labelledby="ai-suggestions-title" className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 id="ai-suggestions-title" className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900"><Sparkles size={15} aria-hidden="true" />Saran balasan AI</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-600">Draf dari chat terakhir. Harga, DP, dan tanggal diisi dari data paket.</p>
      </div>
    </div>

    {!result && <Button className="w-full" loading={suggest.isPending} icon={<Sparkles size={14} />} onClick={request}>{suggest.isPending ? 'Menyusun saran…' : 'Sarankan balasan'}</Button>}
    {suggest.isError && <p role="alert" className="text-xs leading-relaxed text-rose-700">{(suggest.error as Error)?.message || 'Saran tidak dapat dimuat.'}</p>}

    {result && <div className="space-y-3">
      {result.source === 'fallback'
        ? <p role="status" className="flex gap-1.5 text-xs leading-relaxed text-amber-800"><AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />Saran AI tidak tersedia saat ini. Berikut skrip bank yang direkomendasikan.</p>
        : detected && <p role="status" className="text-xs text-zinc-600">{[INTENT_LABEL[detected.intent] ?? detected.intent, detected.objection && `keberatan ${OBJECTION_LABEL[detected.objection] ?? detected.objection}`, `tahap ${detected.stageLabel}`].filter(Boolean).join(' · ')}</p>}
      {detected?.needsInternalInfo && <p className="flex gap-1.5 text-xs leading-relaxed text-amber-800"><AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />Prospek menanyakan hal yang belum ada di data. Pastikan dulu ke tim terkait sebelum menjawab.</p>}
      {result.options.length === 0 && <p className="text-xs text-zinc-600">Belum ada saran yang bisa dipakai untuk chat ini.</p>}
      {result.options.map((option, index) => {
        const blocked = option.status === 'blocked';
        return <article key={`${result.suggestionId}-${index}`} className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3">
          <div>
            <p className={cn('text-xs font-medium', option.origin === 'generated' || option.origin === 'holding' ? 'text-amber-800' : 'text-zinc-500')}>{ORIGIN_LABEL[option.origin]}</p>
            <h4 className={cn('text-sm font-semibold leading-snug', blocked && 'text-zinc-500')}>{option.approach}</h4>
          </div>
          <WhatsAppText text={option.text} className={cn('text-sm leading-relaxed', blocked ? 'text-zinc-500' : 'text-zinc-700')} />
          {option.reasons.length > 0 && <p className={cn('text-xs leading-relaxed', blocked ? 'text-zinc-600' : 'text-amber-800')}>{blocked ? 'Belum bisa dipakai: ' : 'Perlu dicek: '}{option.reasons.join(' · ')}</p>}
          <Button variant="secondary" size="sm" className="w-full" disabled={blocked} onClick={() => onReview(option, { suggestionId: result.suggestionId, optionIndex: index, text: option.text })}>Tinjau & gunakan</Button>
        </article>;
      })}
      <div className="space-y-2">
        <label className="block"><span className="sr-only">Arahan untuk saran berikutnya</span>
          <input className="field w-full text-sm" maxLength={200} value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="Arahan opsional, mis. lebih singkat" onKeyDown={event => { if (event.key === 'Enter' && !suggest.isPending) request(); }} />
        </label>
        <Button variant="ghost" size="sm" className="w-full" loading={suggest.isPending} icon={<RefreshCw size={14} />} onClick={request}>{suggest.isPending ? 'Menyusun ulang…' : 'Buat ulang'}</Button>
      </div>
    </div>}
  </section>;
}
