import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowRightLeft, BadgeCheck, Clock3, FilePenLine, MessageSquareWarning, PhoneCall, Send, SlidersHorizontal, StickyNote, UserRound,
} from 'lucide-react';
import { businessDateKey } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/cn';

export type ProspectLog = {
  id: number; actionType: string; title: string; description: string | null; createdAt: string; user?: { name: string } | null;
};
type History = { logs: ProspectLog[]; legacyNote: string | null; legacyNoteAt: string | null };

/** Satu sumber riwayat untuk tab Catatan dan Riwayat. Kunci di bawah ['prospect', id] ikut disegarkan oleh semua aksi prospek. */
export function useProspectHistory(prospectId: number, brandId?: number) {
  return useQuery({
    queryKey: ['prospect', prospectId, 'logs'],
    queryFn: () => api.get<History>(`/prospects/${prospectId}/logs${brandId ? `?brandId=${brandId}` : ''}`),
    enabled: Boolean(prospectId),
  });
}

const WIB = 'Asia/Jakarta';
const time = (value: string) => new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: WIB }).format(new Date(value));
const dayLabel = (value: string) => {
  const key = businessDateKey(new Date(value));
  const today = businessDateKey();
  const yesterday = businessDateKey(new Date(Date.now() - 86_400_000));
  if (key === today) return 'Hari ini';
  if (key === yesterday) return 'Kemarin';
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: WIB }).format(new Date(value));
};
const stamp = (log: { createdAt: string; user?: { name: string } | null }) => `${log.user?.name ?? 'Sistem'} · ${dayLabel(log.createdAt)}, ${time(log.createdAt)}`;

/**
 * Catatan CS bersifat tambah-saja: yang sudah tersimpan tidak bisa diedit atau dihapus. Koreksi ditulis sebagai
 * catatan baru sehingga supervisor selalu bisa menelusuri apa yang dicatat, oleh siapa, dan kapan.
 */
export function ProspectNotes({ prospectId, brandId, disabledReason }: { prospectId: number; brandId?: number; disabledReason?: string | null }) {
  const history = useProspectHistory(prospectId, brandId);
  const [draft, setDraft] = useState('');
  const add = useMutation({
    mutationFn: (note: string) => api.post<ProspectLog>(`/prospects/${prospectId}/notes`, { note, brandId }),
    onSuccess: () => {
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: ['prospect', prospectId, 'logs'] });
    },
  });
  const notes = (history.data?.logs ?? []).filter((log) => log.actionType === 'note_added');
  const legacy = history.data?.legacyNote;

  return <section className="space-y-3" aria-label="Catatan CS">
    <div className="space-y-2">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-zinc-600">Tambah catatan</span>
        <textarea aria-label="Catatan baru" rows={3} value={draft} maxLength={2000} disabled={Boolean(disabledReason) || add.isPending}
          onChange={(event) => setDraft(event.target.value)} placeholder="Hasil obrolan, preferensi, janji jamaah…" className="field h-auto resize-none py-2" />
      </label>
      {disabledReason
        ? <p className="text-xs text-zinc-600">{disabledReason}</p>
        : <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-zinc-500">Catatan tersimpan tidak bisa diubah.</p>
          <Button size="sm" disabled={!draft.trim()} loading={add.isPending} onClick={() => add.mutate(draft.trim())}>Simpan catatan</Button>
        </div>}
      {add.error && <p role="alert" className="text-xs text-rose-700">{add.error.message}</p>}
    </div>
    {history.isLoading ? <p role="status" className="text-xs text-zinc-600">Memuat catatan…</p>
      : history.isError ? <p role="alert" className="text-xs text-rose-700">Catatan tidak dapat dimuat. <button type="button" className="underline" onClick={() => void history.refetch()}>Coba lagi</button></p>
      : (notes.length || legacy) ? <ol className="space-y-2">
        {notes.map((note) => <li key={note.id} className="rounded-lg bg-zinc-50 px-3 py-2">
          <p className="whitespace-pre-line break-words text-sm leading-relaxed text-zinc-900">{note.description}</p>
          <p className="mt-1 text-xs text-zinc-500">{stamp(note)}</p>
        </li>)}
        {legacy && <li className="rounded-lg bg-zinc-50 px-3 py-2">
          <p className="whitespace-pre-line break-words text-sm leading-relaxed text-zinc-900">{legacy}</p>
          <p className="mt-1 text-xs text-zinc-500">Catatan awal (sebelum riwayat catatan)</p>
        </li>}
      </ol>
      : <p className="text-xs text-zinc-500">Belum ada catatan.</p>}
  </section>;
}

const FILTERS = [
  { id: 'all', label: 'Semua' },
  { id: 'notes', label: 'Catatan' },
  { id: 'changes', label: 'Perubahan data' },
] as const;
type Filter = typeof FILTERS[number]['id'];

function iconFor(type: string) {
  if (type === 'note_added') return StickyNote;
  if (type === 'profile_updated' || type === 'offer_outdated') return FilePenLine;
  if (type === 'status_changed' || type === 'created' || type === 'contact_created') return ArrowRightLeft;
  if (type.startsWith('payment')) return BadgeCheck;
  if (type.startsWith('pic')) return UserRound;
  if (type === 'followup_logged') return PhoneCall;
  if (type === 'objection_logged') return MessageSquareWarning;
  if (type === 'message_sent') return Send;
  if (type.startsWith('custom_')) return SlidersHorizontal;
  return Clock3;
}
/** Pesan chat biasa sudah terlihat di percakapan; riwayat hanya memuat kiriman resmi (penawaran, invoice, dsb.). */
const isPlainChat = (log: ProspectLog) => log.actionType === 'message_sent' && /^(Pesan|Media) dikirim oleh/.test(log.title);

type Entry = ProspectLog & { count: number; firstAt: string };
const MERGE_WINDOW_MS = 15 * 60_000;
const CHANGE = /^(.+?): (.*) → (.*)$/;

/**
 * Simpan otomatis membuat satu log per isian. Perubahan beruntun oleh orang yang sama (jeda ≤ 15 menit) digabung
 * menjadi satu entri: tiap isian ditampilkan dari nilai awal → nilai akhir, yang kembali ke nilai awal dihilangkan.
 */
export function mergeProfileEdits(logs: ProspectLog[]): Entry[] {
  const out: Entry[] = [];
  for (const log of logs) {
    const last = out.at(-1);
    const mergeable = log.actionType === 'profile_updated' && last?.actionType === 'profile_updated'
      && (last.user?.name ?? '') === (log.user?.name ?? '')
      && new Date(last.firstAt).getTime() - new Date(log.createdAt).getTime() <= MERGE_WINDOW_MS;
    if (mergeable) {
      // Log terurut terbaru dulu: `log` lebih lama dari entri yang sedang digabung.
      last.description = [log.description, last.description].filter(Boolean).join('\n') || null;
      last.firstAt = log.createdAt;
      last.count += 1;
    } else {
      out.push({ ...log, count: 1, firstAt: log.createdAt });
    }
  }
  return out.map((entry) => {
    if (entry.actionType !== 'profile_updated') return entry;
    const order: string[] = [];
    const fields = new Map<string, { from: string; to: string }>();
    const other: string[] = [];
    for (const line of (entry.description ?? '').split('\n').filter(Boolean)) {
      const match = CHANGE.exec(line);
      if (!match) { if (!other.includes(line)) other.push(line); continue; }
      const [, label, from, to] = match as unknown as [string, string, string, string];
      const known = fields.get(label);
      if (known) known.to = to;
      else { fields.set(label, { from, to }); order.push(label); }
    }
    const lines = [...order.flatMap((label) => {
      const { from, to } = fields.get(label)!;
      return from === to ? [] : [`${label}: ${from} → ${to}`];
    }), ...other];
    const described = Boolean(entry.description);
    return {
      ...entry,
      title: lines.length === 1 ? `${lines[0]!.split(':')[0]} diubah` : described ? 'Data prospek diubah' : 'Profil prospek diperbarui',
      description: lines.length ? lines.join('\n')
        : described ? 'Perubahan dikembalikan ke nilai semula.'
        : 'Rincian perubahan tidak tercatat (disimpan sebelum pencatatan rinci aktif).',
    };
  });
}

/** Riwayat lengkap prospek, dikelompokkan per hari (WIB), terbaru di atas. Hanya-baca. */
export function ProspectTimeline({ prospectId, brandId }: { prospectId: number; brandId?: number }) {
  const history = useProspectHistory(prospectId, brandId);
  const [filter, setFilter] = useState<Filter>('all');
  if (history.isLoading) return <p role="status" className="text-xs text-zinc-600">Memuat riwayat…</p>;
  if (history.isError) return <p role="alert" className="text-xs text-rose-700">Riwayat tidak dapat dimuat. <button type="button" className="underline" onClick={() => void history.refetch()}>Coba lagi</button></p>;
  const logs = (history.data?.logs ?? []).filter((log) => !isPlainChat(log)).filter((log) =>
    filter === 'all' ? true : filter === 'notes' ? log.actionType === 'note_added' : log.actionType === 'profile_updated' || log.actionType === 'offer_outdated');
  const groups: Array<{ day: string; items: Entry[] }> = [];
  for (const log of mergeProfileEdits(logs)) {
    const day = dayLabel(log.createdAt);
    if (groups.at(-1)?.day === day) groups.at(-1)!.items.push(log);
    else groups.push({ day, items: [log] });
  }

  return <section className="space-y-3" aria-label="Riwayat prospek">
    <div role="radiogroup" aria-label="Saring riwayat" className="flex gap-1">
      {FILTERS.map((item) => <button key={item.id} type="button" role="radio" aria-checked={filter === item.id} onClick={() => setFilter(item.id)}
        className={cn('rounded-full px-2.5 py-1 text-xs font-semibold transition', filter === item.id ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200')}>{item.label}</button>)}
    </div>
    {groups.length === 0 && <p className="text-xs text-zinc-500">Belum ada riwayat{filter === 'all' ? '' : ' untuk filter ini'}.</p>}
    {groups.map((group) => <div key={group.day} className="space-y-2">
      <h4 className="text-xs font-semibold text-zinc-500">{group.day}</h4>
      <ol className="space-y-3">
        {group.items.map((log) => {
          const Icon = iconFor(log.actionType);
          return <li key={log.id} className="flex gap-2.5">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-600"><Icon size={13} aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug text-zinc-900">{log.title}</p>
              {log.description && <p className={cn('mt-0.5 whitespace-pre-line break-words text-xs leading-relaxed', log.description.startsWith('Rincian perubahan tidak tercatat') ? 'italic text-zinc-500' : 'text-zinc-700')}>{log.description}</p>}
              <p className="mt-0.5 text-xs text-zinc-500">{log.user?.name ?? 'Sistem'} · {log.count > 1 && time(log.firstAt) !== time(log.createdAt) ? `${time(log.firstAt)}–${time(log.createdAt)}` : time(log.createdAt)}{log.count > 1 ? ` · ${log.count} kali simpan` : ''}</p>
            </div>
          </li>;
        })}
      </ol>
    </div>)}
  </section>;
}
