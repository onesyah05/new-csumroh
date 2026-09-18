import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CircleDollarSign, Clock3, Inbox, MessageCircleMore, Sparkles, TrendingUp, Trophy, UserPlus2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useBrandScope } from '../../lib/scope';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../app/auth';
import { PageError, PageLoading, SectionEmpty } from '../../components/ui/page-feedback';

const money = (value: unknown) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', notation: 'compact', maximumFractionDigits: 1 }).format(Number(value ?? 0));
export function DashboardPage() {
  const { user } = useAuth(); const { brandId, query } = useBrandScope();
  const dashboard = useQuery({ queryKey: ['dashboard', brandId], queryFn: () => api.get<any>(`/dashboard${query}`), enabled: !!brandId });
  const data = dashboard.data;
  const pipelineValue = (data?.pipeline ?? []).reduce((sum: number, item: any) => sum + Number(item?._sum?.dealValue ?? 0), 0);
  const metrics = [
    { label: 'Total prospek', value: data?.total ?? '—', note: 'Semua pipeline aktif', icon: Inbox },
    { label: 'Nilai pipeline', value: data ? money(pipelineValue) : '—', note: 'Estimasi potensi deal', icon: CircleDollarSign },
    { label: 'Konversi', value: data ? `${data.conversionRate}%` : '—', note: `${data?.won ?? 0} deal berhasil`, icon: Trophy },
    { label: 'Belum ada PIC', value: data?.unassigned ?? '—', note: 'Perlu segera diklaim', icon: UserPlus2 },
  ];
  if (!brandId) return <PageError title="Belum ada brand aktif" description="Buat brand melalui menu Administrasi, lalu isi data operasional sebenarnya untuk membuka ringkasan." />;
  if (dashboard.isLoading) return <PageLoading label="Menyiapkan ringkasan" />;
  if (dashboard.isError) return <PageError description={dashboard.error.message} onRetry={() => void dashboard.refetch()} />;
  return <div className="app-page space-y-7">
    <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[.14em] text-zinc-400"><Sparkles size={13} />Ringkasan hari ini</p><h2 className="page-title">Assalamualaikum, {user?.name.split(' ')[0]}.</h2><p className="mt-2 text-sm text-zinc-500">Ini yang sedang terjadi di {user?.brand?.name ?? 'brand terpilih'}.</p></div><Link to="/inbox"><Button><MessageCircleMore size={16} />Buka kotak masuk</Button></Link></section>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ label,value,note,icon: Icon }, index) => <article key={label} className="surface group p-5 transition hover:-translate-y-0.5 hover:shadow-soft"><div className="mb-5 flex items-start justify-between"><span className="grid h-9 w-9 place-items-center rounded-xl bg-zinc-100 text-zinc-700"><Icon size={18} /></span><span className="text-[10px] font-bold text-zinc-400">0{index + 1}</span></div><p className="font-display text-2xl font-extrabold tracking-tight">{value}</p><p className="mt-1 text-xs font-semibold text-zinc-600">{label}</p><p className="mt-3 border-t pt-3 text-[11px] text-zinc-400">{note}</p></article>)}</section>
    <section className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
      <article className="surface overflow-hidden"><div className="flex items-center justify-between border-b px-5 py-4"><div><h3 className="font-display font-bold">Aktivitas prospek terbaru</h3><p className="mt-0.5 text-xs text-zinc-400">Perubahan terakhir dari tim</p></div><Link to="/pipeline" className="flex items-center gap-1 text-xs font-bold text-zinc-600 hover:text-black">Lihat pipeline <ArrowRight size={14} /></Link></div><div className="divide-y">{data?.recent?.map((item: any) => <Link to={`/prospects/${item.id}`} key={item.id} className="flex items-center gap-3 px-5 py-4 transition hover:bg-zinc-50"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-zinc-100 text-xs font-bold">{String(item.name ?? '?').slice(0,2).toUpperCase()}</span><span className="min-w-0 flex-1"><b className="block truncate text-sm">{item.name}</b><span className="text-xs text-zinc-400">{item.city || item.phone} · {item.user?.name ?? 'Belum ada PIC'}</span></span><Badge value={item.status} /></Link>)}{!data?.recent?.length && <div className="p-4"><SectionEmpty title="Belum ada aktivitas" description="Aktivitas terbaru tim akan muncul di sini." /></div>}</div></article>
      <aside className="space-y-5"><article className="surface p-5"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-zinc-400">WhatsApp gateway</p><h3 className="mt-2 font-display text-lg font-bold">{data?.wa?.status === 'connected' ? 'Terhubung & aktif' : 'Belum terhubung'}</h3></div><span className={`h-3 w-3 rounded-full ${data?.wa?.status === 'connected' ? 'bg-emerald-600' : 'bg-zinc-300'}`} /></div><p className="mt-3 text-sm leading-6 text-zinc-500">{data?.wa?.phoneNumber ?? 'Hubungkan nomor WhatsApp brand untuk mulai menerima pesan.'}</p></article><article className="overflow-hidden rounded-2xl bg-zinc-950 p-5 text-white"><TrendingUp size={22} className="text-zinc-400" /><p className="mt-7 text-xs uppercase tracking-[.16em] text-zinc-500">Fokus tim</p><h3 className="mt-2 font-display text-xl font-bold leading-snug">Respons lebih cepat, percakapan lebih manusiawi.</h3><p className="mt-3 text-xs leading-5 text-zinc-400">Gunakan Copilot sebagai panduan, lalu sesuaikan dengan konteks jamaah.</p></article></aside>
    </section>
  </div>;
}
