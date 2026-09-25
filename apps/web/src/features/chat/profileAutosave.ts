import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { paxFields, profileForm, type ProfileForm } from './profileDraft';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type Patch = Partial<ProfileForm>;

/** Payload API dari isian form: hanya isian yang diubah, dengan tipe yang diharapkan server. */
function toPayload(patch: Patch) {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if ((paxFields as readonly string[]).includes(key)) payload[key] = Number(value) || 0;
    else if (key === 'nextFollowupDate') payload[key] = value ? `${value}T00:00:00.000Z` : null;
    else if (key !== 'packageId') payload[key] = value;
  }
  return payload;
}

/**
 * Simpan otomatis per isian untuk panel profil. Setiap perubahan hanya mengirim isian yang diubah, sehingga
 * perubahan orang lain pada isian lain tidak tertimpa dan tidak perlu draft/tombol Simpan.
 * - Pilihan disimpan segera; teks memakai jeda (`delay`) dan `flush()` saat kolom ditinggalkan.
 * - Ditolak server (4xx, mis. syarat kualifikasi dikosongkan): nilai kembali ke data server, pesan ditampilkan.
 * - Gangguan jaringan: isian tetap di layar dan bisa dicoba lagi (`retry`).
 */
export function useProfileAutosave(options: {
  prospectId: number;
  brandId?: number;
  source: unknown;
  onSaved?(result: any, patch: Patch): void;
}) {
  const { prospectId, brandId, source, onSaved } = options;
  const [local, setLocal] = useState<Patch>({});
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Patch>({});
  const timer = useRef<number | undefined>(undefined);
  const inflight = useRef(0);
  const target = useRef({ prospectId, brandId });
  const savedCallback = useRef(onSaved);
  savedCallback.current = onSaved;

  async function flush() {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return;
    if ('name' in patch && !String(patch.name ?? '').trim()) {
      setError('Nama wajib diisi.');
      setState('error');
      return;
    }
    const { prospectId: id, brandId: brand } = target.current;
    inflight.current += 1;
    setState('saving');
    setError(null);
    try {
      const result = await api.patch<any>(`/prospects/${id}/profile`, { ...toPayload(patch), brandId: brand });
      queryClient.setQueryData(['prospect', id, brand], result);
      // Setiap simpan tercatat di riwayat (nilai lama → baru).
      void queryClient.invalidateQueries({ queryKey: ['prospect', id, 'logs'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations', brand] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      // Isian yang sudah tersimpan kembali mengikuti data server (kecuali diubah lagi selama menyimpan).
      setLocal((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(patch) as (keyof ProfileForm)[]) if (next[key] === patch[key]) delete next[key];
        return next;
      });
      inflight.current -= 1;
      if (inflight.current === 0) setState('saved');
      savedCallback.current?.(result, patch);
    } catch (err: any) {
      inflight.current -= 1;
      setError(err?.message || 'Gagal menyimpan.');
      setState('error');
      if (err?.status >= 400 && err?.status < 500) {
        // Ditolak aturan server: kembalikan isian ke nilai server, jangan dicoba ulang.
        setLocal((prev) => {
          const next = { ...prev };
          for (const key of Object.keys(patch) as (keyof ProfileForm)[]) delete next[key];
          return next;
        });
      } else {
        pending.current = { ...patch, ...pending.current };
      }
    }
  }

  function change(patch: Patch, delay = 0) {
    setLocal((prev) => ({ ...prev, ...patch }));
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), delay);
  }

  // Berpindah prospek: simpan sisa perubahan prospek sebelumnya, lalu mulai bersih.
  useEffect(() => {
    if (target.current.prospectId !== prospectId || target.current.brandId !== brandId) {
      void flush();
      target.current = { prospectId, brandId };
      setLocal({});
      setState('idle');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospectId, brandId]);
  useEffect(() => () => { void flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // "Tersimpan" cukup terlihat sebentar.
  useEffect(() => {
    if (state !== 'saved') return;
    const id = window.setTimeout(() => setState('idle'), 2500);
    return () => window.clearTimeout(id);
  }, [state]);

  const form = { ...profileForm(source), ...local } as ProfileForm;
  return { form, change, flush, retry: () => void flush(), state, error };
}
