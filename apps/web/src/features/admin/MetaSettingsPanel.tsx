import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, KeyRound, Link2, Radio, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { queryClient } from '../../app/query';
import { Button } from '../../components/ui/button';
import { PageError, PageLoading, SectionEmpty } from '../../components/ui/page-feedback';

type MetaSettings = {
  brandId: number;
  brandName: string;
  pixelId: string;
  facebookPageId: string;
  whatsappBusinessAccountId: string;
  testEventCode: string;
  accessTokenConfigured: boolean;
  connectionConfigured: boolean;
  ctwaReady: boolean;
  verifiedAt: string | null;
  lastError: string | null;
};

type MetaLog = {
  id: number;
  eventName: string;
  eventId: string;
  status: 'pending' | 'success' | 'failed';
  responseStatus: number | null;
  responseBody: string | null;
  createdAt: string;
  prospect: { id: number; name: string };
};

const emptyForm = { pixelId: '', facebookPageId: '', whatsappBusinessAccountId: '', accessToken: '', testEventCode: '' };

export function MetaSettingsPanel({ brandId }: { brandId: number }) {
  const query = `?brandId=${brandId}`;
  const settings = useQuery({ queryKey: ['meta-settings', brandId], queryFn: () => api.get<MetaSettings>(`/meta/settings${query}`) });
  const logs = useQuery({ queryKey: ['meta-logs', brandId], queryFn: () => api.get<MetaLog[]>(`/meta/logs${query}`) });
  const [form, setForm] = useState(emptyForm);
  useEffect(() => {
    if (!settings.data) return;
    setForm({ pixelId: settings.data.pixelId, facebookPageId: settings.data.facebookPageId, whatsappBusinessAccountId: settings.data.whatsappBusinessAccountId, accessToken: '', testEventCode: settings.data.testEventCode });
  }, [settings.data]);

  const save = useMutation<MetaSettings, Error, boolean>({
    mutationFn: (clearAccessToken = false) => api.put<MetaSettings>('/meta/settings', { brandId, ...form, accessToken: form.accessToken || undefined, clearAccessToken }),
    onSuccess: (data) => {
      queryClient.setQueryData(['meta-settings', brandId], data);
      setForm((current) => ({ ...current, accessToken: '' }));
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
    },
  });
  const verify = useMutation({
    mutationFn: () => api.post<{ connected: boolean; pixelName: string | null; verifiedAt: string; ctwaReady: boolean }>('/meta/verify', { brandId }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['meta-settings', brandId] }),
  });
  const submit = (event: FormEvent) => { event.preventDefault(); save.mutate(false); };

  if (settings.isLoading) return <PageLoading label="Memuat konfigurasi Meta" />;
  if (settings.isError) return <PageError description={settings.error.message} onRetry={() => void settings.refetch()} />;
  const data = settings.data;
  if (!data) return null;

  return <div className="space-y-5">
    <section className="grid gap-3 md:grid-cols-3">
      <StatusCard icon={Link2} label="Koneksi Pixel" value={data.verifiedAt ? 'Terverifikasi' : data.connectionConfigured ? 'Belum diverifikasi' : 'Belum diatur'} active={Boolean(data.verifiedAt)} />
      <StatusCard icon={Radio} label="Tracking CTWA" value={data.ctwaReady ? 'Siap menerima event' : 'Konfigurasi belum lengkap'} active={data.ctwaReady} />
      <StatusCard icon={ShieldCheck} label="Access token" value={data.accessTokenConfigured ? 'Tersimpan terenkripsi' : 'Belum tersimpan'} active={data.accessTokenConfigured} />
    </section>

    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <form onSubmit={submit} className="surface p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-3 border-b pb-5 sm:flex-row sm:items-start">
          <div><p className="page-kicker"><Radio size={14} />Meta Conversions API</p><h3 className="mt-2 font-display text-xl font-extrabold">Pixel & CTWA · {data.brandName}</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">Konfigurasi ini hanya digunakan oleh brand ini. Token tidak pernah ditampilkan kembali setelah disimpan.</p></div>
          <Button type="button" variant="secondary" size="sm" disabled={!data.connectionConfigured || verify.isPending} onClick={() => verify.mutate()}><RefreshCw size={14} className={verify.isPending ? 'animate-spin' : ''} />{verify.isPending ? 'Memeriksa…' : 'Tes koneksi'}</Button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Pixel / Dataset ID" hint="ID sumber data pada Meta Events Manager."><input inputMode="numeric" className="field" value={form.pixelId} onChange={(event) => setForm({ ...form, pixelId: event.target.value.replace(/\D/g, '') })} placeholder="Contoh: 123456789012345" required /></Field>
          <Field label="Facebook Page ID" hint="Page yang digunakan oleh iklan Click-to-WhatsApp."><input inputMode="numeric" className="field" value={form.facebookPageId} onChange={(event) => setForm({ ...form, facebookPageId: event.target.value.replace(/\D/g, '') })} placeholder="Contoh: 123456789012345" required /></Field>
          <Field label="WhatsApp Business Account ID" hint="Diperlukan agar atribusi CTWA dikenali sebagai business messaging."><input inputMode="numeric" className="field" value={form.whatsappBusinessAccountId} onChange={(event) => setForm({ ...form, whatsappBusinessAccountId: event.target.value.replace(/\D/g, '') })} placeholder="WABA ID" required /></Field>
          <Field label="Test Event Code" hint="Opsional. Hapus setelah pengujian agar event masuk ke laporan produksi."><input className="field" value={form.testEventCode} onChange={(event) => setForm({ ...form, testEventCode: event.target.value.trim() })} placeholder="TEST12345" /></Field>
        </div>
        <div className="mt-4"><Field label="System User Access Token" hint={data.accessTokenConfigured ? 'Token sudah tersimpan. Kosongkan jika tidak ingin menggantinya.' : 'Buat token permanen dengan izin terhadap Pixel/Dataset terkait.'}><div className="flex flex-col gap-2 sm:flex-row"><div className="relative flex-1"><KeyRound size={16} className="absolute left-3 top-3 text-zinc-400" /><input type="password" autoComplete="new-password" className="field pl-10" value={form.accessToken} onChange={(event) => setForm({ ...form, accessToken: event.target.value })} placeholder={data.accessTokenConfigured ? '••••••••••••••••' : 'Tempel access token Meta'} /></div>{data.accessTokenConfigured && <Button type="button" variant="danger" onClick={() => save.mutate(true)} disabled={save.isPending}>Hapus token</Button>}</div></Field></div>
        {(save.error || verify.error || data.lastError) && <div className="mt-4 flex gap-3 rounded-xl border border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-700"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><p>{save.error?.message ?? verify.error?.message ?? data.lastError}</p></div>}
        {verify.isSuccess && <div className="mt-4 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 size={18} className="mt-0.5 shrink-0" /><p>Koneksi Pixel berhasil diverifikasi. {data.ctwaReady ? 'Konfigurasi CTWA lengkap.' : 'Lengkapi Page ID dan WABA ID untuk tracking CTWA.'}</p></div>}
        {form.testEventCode && <div className="mt-4 flex gap-3 rounded-xl bg-zinc-100 p-4 text-xs leading-5 text-zinc-600"><AlertTriangle size={16} className="mt-0.5 shrink-0" />Mode Test Events aktif. Event dengan kode ini tidak masuk laporan produksi sampai kode dihapus.</div>}
        <div className="mt-6 flex justify-end"><Button disabled={save.isPending}>{save.isPending ? 'Menyimpan…' : 'Simpan konfigurasi'}</Button></div>
      </form>

      <aside className="space-y-4">
        <article className="surface p-5"><p className="text-xs font-bold uppercase tracking-[.12em] text-zinc-400">Event otomatis</p><div className="mt-4 space-y-3">{[['Contact','Prospek baru dari CTWA'],['AddToCart','Paket sudah ditawarkan'],['InitiateCheckout','Masuk tahap closing / DP'],['Purchase','Deal berhasil']].map(([event,label]) => <div key={event} className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"><div><b className="block text-sm">{event}</b><span className="text-xs text-zinc-400">{label}</span></div><span className="h-2 w-2 rounded-full bg-zinc-900" /></div>)}</div></article>
        <article className="rounded-2xl bg-zinc-950 p-5 text-white"><ShieldCheck size={20} className="text-zinc-400" /><h4 className="mt-5 font-display font-bold">Atribusi first-touch</h4><p className="mt-2 text-xs leading-5 text-zinc-400">Click ID iklan pertama disimpan pada prospek dan tidak ditimpa pesan berikutnya. Purchase memakai nilai transaksi final, bukan nilai demo atau fallback.</p></article>
      </aside>
    </section>

    <section className="surface overflow-hidden"><div className="flex items-center justify-between border-b px-5 py-4"><div><h3 className="font-display font-bold">Audit event Meta</h3><p className="mt-1 text-xs text-zinc-400">50 pengiriman terakhir untuk brand ini.</p></div>{logs.isFetching && <RefreshCw size={15} className="animate-spin text-zinc-400" />}</div>{logs.isError ? <div className="p-5"><PageError description={logs.error.message} onRetry={() => void logs.refetch()} /></div> : !logs.data?.length ? <SectionEmpty title="Belum ada event" description="Log muncul setelah prospek CTWA bergerak melalui pipeline." /> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="border-b bg-zinc-50 text-[10px] uppercase tracking-[.1em] text-zinc-400"><tr><th className="px-5 py-3">Event</th><th className="px-4">Prospek</th><th className="px-4">Status</th><th className="px-4">Respons</th><th className="px-5">Waktu</th></tr></thead><tbody className="divide-y">{logs.data.map((log) => <tr key={log.id} className="text-sm"><td className="px-5 py-4"><b>{log.eventName}</b><p className="mt-1 max-w-60 truncate font-mono text-[10px] text-zinc-400">{log.eventId}</p></td><td className="px-4">{log.prospect.name}</td><td className="px-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${log.status === 'success' ? 'bg-emerald-600 text-white' : log.status === 'failed' ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-950 text-white'}`}>{log.status}</span></td><td className="px-4 text-xs text-zinc-500">{log.responseStatus ?? '—'}{log.status === 'failed' && log.responseBody ? ` · ${log.responseBody.slice(0, 80)}` : ''}</td><td className="px-5 text-xs text-zinc-400">{new Date(log.createdAt).toLocaleString('id-ID')}</td></tr>)}</tbody></table></div>}</section>
  </div>;
}

function StatusCard({ icon: Icon, label, value, active }: { icon: typeof Link2; label: string; value: string; active: boolean }) {
  return <article className="surface flex items-center gap-4 p-5"><span className={`grid h-11 w-11 place-items-center rounded-xl ${active ? 'bg-zinc-950 text-white' : 'bg-zinc-100 text-zinc-500'}`}><Icon size={19} /></span><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-zinc-400">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div></article>;
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}<span className="mt-1.5 block text-[11px] leading-4 text-zinc-400">{hint}</span></label>;
}
