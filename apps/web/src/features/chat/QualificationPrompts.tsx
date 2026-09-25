import { useId, useState } from 'react';
import { CornerDownLeft, MessageCircle } from 'lucide-react';
import { adultPaxOf, BUDGET_OPTIONS, PASSPORT_OPTIONS, parseTargetMonth } from '@csumroh/shared-types';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { Select } from '../../components/ui/select';
import type { QualificationValue } from '../prospects/QualificationFields';
import { unresolvedScript, useScriptLibrary } from './scriptLibrary';

const topics = [
  { field: 'targetMonth', label: 'Bulan keberangkatan' },
  { field: 'pax', label: 'Jumlah jamaah' },
  { field: 'room', label: 'Preferensi kamar' },
  { field: 'budgetRange', label: 'Budget per orang' },
  { field: 'passportStatus', label: 'Paspor' },
] as const;
type Topic = typeof topics[number]['field'];
type Prompt = { id: string; qualificationField: Topic; title: string; script: string };
type Value = Partial<QualificationValue>;

function valueKey(field: Topic, value: Value) {
  return field === 'pax' || field === 'room'
    ? JSON.stringify([value.paxQuad, value.paxTriple, value.paxDouble, value.paxInfant])
    : value[field] ?? '';
}
function topicState(field: Topic, value: Value): 'missing' | 'legacy' | 'filled' {
  if (field === 'room') return 'filled'; // Room choices share the pax fields; never infer confirmation.
  if (field === 'pax') return adultPaxOf(value) < 1 ? 'missing' : 'filled';
  if (!value[field]?.trim()) return 'missing';
  if (field === 'targetMonth') return parseTargetMonth(value.targetMonth).key ? 'filled' : 'legacy';
  const options = field === 'budgetRange' ? BUDGET_OPTIONS : PASSPORT_OPTIONS;
  return options.some(option => option.value === value[field]) ? 'filled' : 'legacy';
}

export function QualificationPrompts({ value, brandId, prospectId, revision, packageId, query, disabled, onInsertText }: {
  /** Saved prospect data: a failed autosave must not advance the suggestion. */
  value: Value; brandId?: number; prospectId?: number | null; revision?: string | null; packageId?: number | null; query?: string;
  disabled?: boolean; onInsertText(text: string): void;
}) {
  const scripts = useScriptLibrary({ brandId, prospectId, revision, packageId, query });
  const [showChoices, setShowChoices] = useState(false);
  const [manual, setManual] = useState<{ field: Topic; value: string } | null>(null);
  const choicesId = useId();
  const prompts: Prompt[] = (scripts.data?.categories?.identification?.scripts ?? []).filter((item: Prompt) =>
    topics.some(topic => topic.field === item.qualificationField) && typeof item.script === 'string' && item.script.trim());
  const recommended = topics.find(topic => topicState(topic.field, value) === 'missing')
    ?? topics.find(topic => topicState(topic.field, value) === 'legacy');
  const manualField = manual && manual.value === valueKey(manual.field, value) ? manual.field : undefined;
  const field = manualField ?? recommended?.field;
  const prompt = prompts.find(item => item.qualificationField === field);
  const hasUnresolved = prompt && unresolvedScript(prompt.script);

  return <Card className="space-y-3 p-3 sm:p-3" aria-label="Panduan pertanyaan kualifikasi">
    <CardHeader title="Pertanyaan berikutnya" icon={<MessageCircle size={15} aria-hidden="true" />} />
    {scripts.isLoading ? <p role="status" className="text-xs text-zinc-600">Memuat pertanyaan…</p>
      : scripts.isError ? <div role="alert" className="space-y-2 text-xs text-zinc-600">
        <p>Pertanyaan tidak dapat dimuat. Form tetap dapat diisi.</p>
        <Button variant="secondary" onClick={() => void scripts.refetch()}>Muat ulang pertanyaan</Button>
      </div>
      : <>
        {prompt ? <>
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-zinc-900">{prompt.title}</h4>
            {field && topicState(field, value) === 'legacy' && <p className="text-xs text-amber-800">Data lama: konfirmasikan kembali, lalu pilih nilai yang sesuai.</p>}
            <p className="whitespace-pre-line break-words text-sm leading-relaxed text-zinc-700">{prompt.script}</p>
          </div>
          <Button className="w-full" disabled={disabled || hasUnresolved} icon={<CornerDownLeft size={14} aria-hidden="true" />}
            onClick={() => onInsertText(prompt.script.trim())}>Tambahkan ke draft</Button>
          {hasUnresolved && <p role="alert" className="text-xs text-amber-800">Skrip memuat informasi yang belum lengkap. Tinjau dan lengkapi melalui Copilot.</p>}
          {disabled && <p className="text-xs text-zinc-600">Hanya PIC yang dapat menggunakan pertanyaan untuk prospek ini.</p>}
          <p className="text-xs leading-relaxed text-zinc-600">Periksa draft sebelum mengirim. Setelah jamaah menjawab, catat jawabannya di form.</p>
        </> : <p className="text-xs leading-relaxed text-zinc-600">{field
          ? 'Pertanyaan untuk data ini belum tersedia. Pilih pertanyaan lain atau gunakan Copilot.'
          : 'Data utama sudah terisi. Pilih pertanyaan lain bila perlu konfirmasi ulang.'}</p>}
        {prompts.length > 0 && <>
          <Button variant="ghost" className="w-full" aria-expanded={showChoices} aria-controls={choicesId}
            onClick={() => setShowChoices(previous => !previous)}>{showChoices ? 'Tutup pilihan pertanyaan' : 'Lihat pertanyaan lain'}</Button>
          {showChoices && <div id={choicesId} className="space-y-2">
            <Select className="w-full" aria-label="Pilih pertanyaan kualifikasi" value={manualField ?? 'recommended'}
              onValueChange={next => setManual(next === 'recommended' ? null : { field: next as Topic, value: valueKey(next as Topic, value) })}
              options={[
                { value: 'recommended', label: 'Ikuti data yang belum lengkap' },
                ...topics.filter(topic => prompts.some(item => item.qualificationField === topic.field)).map(topic => ({
                  value: topic.field,
                  label: `${topic.label}${topicState(topic.field, value) === 'missing' ? ' · Belum diisi' : topicState(topic.field, value) === 'legacy' ? ' · Data lama' : ''}`,
                })),
              ]} />
            <p className="text-xs leading-relaxed text-zinc-600">Angka bawaan seperti 1 dewasa belum tentu sudah dikonfirmasi. Tanyakan jumlah jamaah dan pilihan kamar secara bertahap.</p>
          </div>}
        </>}
      </>}
  </Card>;
}
