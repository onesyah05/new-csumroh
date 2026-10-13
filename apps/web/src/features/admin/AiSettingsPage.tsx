import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { KeyRound, PlugZap } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { queryClient } from '../../app/query';
import { showFeedback } from '../../app/toast';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/ui/page-header';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { Select } from '../../components/ui/select';
import { Toggle } from '../../components/ui/toggle';

export type AiSettings = {
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  model: string;
  models: Array<{ value: string; label: string }>;
  pilotUserIds: number[];
  dailyLimitPerUser: number;
  updatedAt: string | null;
  updatedBy: string | null;
  usage: { suggestions: number; fromAi: number; used: number; estimatedUsd: number };
};
type Staff = { id: number; name: string; role: string; isActive: boolean; brand: { name: string } | null };
type TestResult = { ok: true; model: string; latencyMs: number } | { ok: false; message: string };

const SETTINGS_KEY = ['ai-settings'] as const;
const ROLE_LABEL: Record<string, string> = { cs: 'CS', admin: 'Admin', superadmin: 'Superadmin' };

/**
 * Pengaturan Asisten AI (Saran Balasan di Copilot Inbox). Hanya Superadmin. Kunci API disimpan terenkripsi di server
 * dan tidak pernah ditampilkan ulang; yang terlihat hanya 4 karakter terakhir.
 */
export function AiSettingsPage() {
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api.get<AiSettings>('/ai/settings') });
  const staff = useQuery({ queryKey: ['staff', ''], queryFn: () => api.get<Staff[]>('/catalog/users') });

  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState('');
  const [limit, setLimit] = useState('150');
  const [pilotOnly, setPilotOnly] = useState(false);
  const [pilot, setPilot] = useState<number[]>([]);
  const [newKey, setNewKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  // Formulir diisi ulang dari server setiap data tersimpan berubah.
  useEffect(() => {
    const data = settings.data;
    if (!data) return;
    setEnabled(data.enabled);
    setModel(data.model);
    setLimit(String(data.dailyLimitPerUser));
    setPilotOnly(data.pilotUserIds.length > 0);
    setPilot(data.pilotUserIds);
    setNewKey('');
    setRemoveKey(false);
    setTest(null);
  }, [settings.data]);

  const eligible = useMemo(() => (staff.data ?? []).filter((user) => user.isActive && ROLE_LABEL[user.role]), [staff.data]);
  const hasKey = !removeKey && (Boolean(newKey.trim()) || Boolean(settings.data?.hasApiKey));
  const limitNumber = Number(limit);
  const limitValid = Number.isInteger(limitNumber) && limitNumber >= 1 && limitNumber <= 2000;
  const keyValid = !newKey.trim() || newKey.trim().length >= 20;

  const save = useMutation({
    mutationFn: () => api.put<AiSettings>('/ai/settings', {
      enabled,
      model,
      dailyLimitPerUser: limitNumber,
      pilotUserIds: pilotOnly ? pilot : [],
      ...(newKey.trim() ? { apiKey: newKey.trim() } : removeKey ? { apiKey: null } : {}),
    }),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_KEY, data);
      void queryClient.invalidateQueries({ queryKey: ['ai-status'] });
      showFeedback('Pengaturan Asisten AI tersimpan.');
    },
    onError: (error: Error) => showFeedback(error.message, { error: true }),
  });
  const runTest = useMutation({
    mutationFn: () => api.post<TestResult>('/ai/settings/test', { ...(newKey.trim() ? { apiKey: newKey.trim() } : {}), model }),
    onMutate: () => setTest(null),
    onSuccess: setTest,
    onError: (error: Error) => setTest({ ok: false, message: error.message }),
  });

  if (settings.isLoading) return <PageLoading label="Memuat pengaturan Asisten AI…" />;
  if (settings.isError) return <PageError description={settings.error.message} onRetry={() => void settings.refetch()} />;
  const data = settings.data!;
  const usage = data.usage;
  const blockers = [
    enabled && !hasKey && 'Isi kunci API sebelum mengaktifkan.',
    pilotOnly && pilot.length === 0 && 'Pilih minimal satu peserta pilot, atau pilih semua CS & Admin.',
    !limitValid && 'Batas harian harus 1–2.000.',
    !keyValid && 'Kunci API terlalu pendek.',
  ].filter(Boolean) as string[];

  return (
    <div className="app-page space-y-4 md:space-y-6">
      <PageHeader
        title="Asisten AI"
        subtitle="Saran balasan untuk CS di Copilot Kotak masuk. Draf dari AI, harga dan tanggal tetap diisi dari data paket; CS yang mengirim."
      />

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="flex items-start gap-3 px-4 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-zinc-900">Aktifkan saran balasan AI</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-600">
              {enabled ? 'Tombol "Sarankan balasan" tampil di Copilot untuk peserta di bawah.' : 'Mati: tombol saran AI tidak tampil untuk siapa pun.'}
            </p>
          </div>
          <Toggle checked={enabled} label="Aktifkan saran balasan AI" onChange={setEnabled} />
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white px-4 py-4">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-zinc-900"><KeyRound size={15} aria-hidden="true" />Kunci API Claude</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-600">Buat kunci di Claude Console (platform.claude.com → API keys). Kunci disimpan terenkripsi dan tidak ditampilkan lagi setelah disimpan.</p>
        </div>
        {data.hasApiKey && !removeKey && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm">
            <span>Tersimpan <span className="font-mono text-zinc-600">{data.apiKeyHint}</span></span>
            <Button variant="ghost" size="sm" className="text-rose-700" onClick={() => { setRemoveKey(true); setNewKey(''); setEnabled(false); setTest(null); }}>Hapus kunci</Button>
          </div>
        )}
        {removeKey && <p className="text-xs text-amber-800">Kunci akan dihapus saat disimpan dan Asisten AI dimatikan. <button type="button" className="font-semibold underline" onClick={() => setRemoveKey(false)}>Batalkan</button></p>}
        <label className="panel-field">
          <span>{data.hasApiKey && !removeKey ? 'Ganti dengan kunci baru (opsional)' : 'Kunci API'}</span>
          <input
            className="field w-full font-mono text-sm"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={newKey}
            onChange={(event) => { setNewKey(event.target.value); setRemoveKey(false); setTest(null); }}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon={<PlugZap size={14} />} loading={runTest.isPending} disabled={!hasKey || !keyValid} onClick={() => runTest.mutate()}>Tes koneksi</Button>
          {test && (
            <p role="status" className={cn('text-xs', test.ok ? 'text-emerald-700' : 'text-rose-700')}>
              {test.ok ? `Terhubung ke ${test.model} (${(test.latencyMs / 1000).toFixed(1)} detik).` : test.message}
            </p>
          )}
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-zinc-200 bg-white px-4 py-4">
        <label className="panel-field">
          <span>Model</span>
          <Select aria-label="Model AI" className="w-full sm:w-96" value={model} onValueChange={(value) => { setModel(value); setTest(null); }} options={data.models} />
        </label>
        <label className="panel-field">
          <span>Batas saran per orang per hari</span>
          <input className="field w-32" inputMode="numeric" value={limit} onChange={(event) => setLimit(event.target.value.replace(/\D/g, ''))} />
        </label>
      </section>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white px-4 py-4">
        <h2 className="text-sm font-bold text-zinc-900">Siapa yang bisa memakai</h2>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="ai-audience" checked={!pilotOnly} onChange={() => setPilotOnly(false)} />Semua CS & Admin</label>
          <label className="flex items-center gap-2"><input type="radio" name="ai-audience" checked={pilotOnly} onChange={() => setPilotOnly(true)} />Hanya peserta pilot</label>
        </div>
        {pilotOnly && (
          staff.isLoading ? <p className="text-xs text-zinc-600">Memuat daftar staf…</p> : (
            <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200">
              {eligible.map((user) => (
                <li key={user.id}>
                  <label className="flex items-center gap-3 px-3 py-2 text-sm">
                    <input type="checkbox" checked={pilot.includes(user.id)} onChange={(event) => setPilot(event.target.checked ? [...pilot, user.id] : pilot.filter((id) => id !== user.id))} />
                    <span className="min-w-0 flex-1 truncate">{user.name}</span>
                    <span className="shrink-0 text-xs text-zinc-600">{ROLE_LABEL[user.role]}{user.brand ? ` · ${user.brand.name}` : ''}</span>
                  </label>
                </li>
              ))}
            </ul>
          )
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white px-4 py-4">
        <h2 className="text-sm font-bold text-zinc-900">Pemakaian bulan ini</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Saran diminta', usage.suggestions.toLocaleString('id-ID')],
            ['Dari AI', usage.fromAi.toLocaleString('id-ID')],
            ['Dipakai CS', usage.used.toLocaleString('id-ID')],
            ['Perkiraan biaya', `$${usage.estimatedUsd.toFixed(2)}`],
          ].map(([label, value]) => (
            <div key={label}><dt className="text-xs text-zinc-600">{label}</dt><dd className="text-lg font-semibold tabular-nums text-zinc-900">{value}</dd></div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-zinc-600">Perkiraan dari jumlah token. Tagihan dan batas belanja sebenarnya ada di Claude Console.</p>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {data.updatedAt && <p className="mr-auto text-xs text-zinc-600">Terakhir diubah {new Date(data.updatedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}{data.updatedBy ? ` oleh ${data.updatedBy}` : ''}</p>}
        {blockers.length > 0 && <p role="alert" className="text-xs text-amber-800">{blockers[0]}</p>}
        <Button loading={save.isPending} disabled={blockers.length > 0} onClick={() => save.mutate()}>Simpan</Button>
      </div>
    </div>
  );
}
