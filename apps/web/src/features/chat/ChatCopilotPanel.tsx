import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, CornerDownLeft, Search, Sparkles, X } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { ModalFrame } from '../../components/ui/modal';

const categories = [
  { id: 'greeting', label: 'Sapaan' }, { id: 'identification', label: 'Kualifikasi' },
  { id: 'offer', label: 'Paket & solusi' }, { id: 'objection', label: 'Keberatan' },
  { id: 'followups', label: 'Follow-up' }, { id: 'closing', label: 'Pembayaran' },
];
export function recommendedCategory(stage?: string) {
  if (stage === 'objection') return 'objection';
  if (['qualified'].includes(stage || '')) return 'offer';
  if (['offer', 'offered', 'followup', 'nurture', 'lose', 'closed_lost'].includes(stage || '')) return 'followups';
  if (['closing', 'deal', 'closed_won'].includes(stage || '')) return 'closing';
  if (['contact', 'identifying'].includes(stage || '')) return 'identification';
  return 'greeting';
}
export function unresolvedScript(text: string) { return /\{\{[^}]+\}\}|\[konfirmasi[^\]]*\]/i.test(text); }
interface Props {
  prospectName?: string; packageId?: number | null; packageName?: string; brandId?: number;
  brandName?: string; query?: string; stage?: string; objection?: string;
  onInsertText(text: string): void; onShowToast(message: string): void;
}
export function ChatCopilotPanel({ prospectName = 'Bapak/Ibu', packageId, packageName, brandId, brandName, query = '', stage, objection, onInsertText, onShowToast }: Props) {
  const [category, setCategory] = useState('recommended');
  const [search, setSearch] = useState('');
  const [framework, setFramework] = useState('all');
  const [review, setReview] = useState<{ title: string; text: string; step?: string } | null>(null);
  const [copyError, setCopyError] = useState('');
  const scripts = useQuery({ queryKey: ['scripts', brandId, prospectName, packageId], queryFn: () => api.get<any>(`/scripts${query}${query ? '&' : '?'}nama=${encodeURIComponent(prospectName)}${packageId ? `&packageId=${packageId}` : ''}`), enabled: !!brandId, staleTime: 60_000 });
  const recommended = recommendedCategory(stage);
  const items = useMemo(() => categories.flatMap(cat => (scripts.data?.categories?.[cat.id]?.scripts ?? []).map((item: any, index: number) => ({ ...item, categoryId: cat.id, categoryLabel: cat.label, key: `${cat.id}:${item.id || index}` }))), [scripts.data]);
  const filtered = useMemo(() => {
    const found = items.filter(item => {
      if (search.trim()) return `${item.title} ${item.script} ${item.use_when} ${item.steps?.map((step: any) => step.text).join(' ') || ''}`.toLocaleLowerCase('id-ID').includes(search.trim().toLocaleLowerCase('id-ID'));
      if (category !== 'all' && item.categoryId !== (category === 'recommended' ? recommended : category)) return false;
      return category !== 'identification' || framework === 'all' || (item.npgd?.code || item.category) === framework;
    });
    return category === 'recommended' && !search.trim() ? found.slice(0, 3) : found;
  }, [items, category, framework, search, recommended]);
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setCopyError(''); onShowToast('Skrip tersalin. Belum dikirim ke jamaah.'); } catch { setCopyError('Clipboard tidak tersedia. Pilih teks lalu salin secara manual.'); } }
  const contextCategory = categories.find(item => item.id === recommended)?.label;
  return <div className="sales-panel flex h-full min-h-0 flex-col bg-white">
    <header className="shrink-0 space-y-3 border-b border-zinc-200 p-4">
      <div><h2 className="text-sm font-semibold">Bantuan percakapan</h2><p className="mt-1 break-words text-xs text-zinc-600">{prospectName} · {brandName || 'Brand aktif'}</p>{packageName && <p className="mt-1 line-clamp-2 text-xs text-zinc-600" title={packageName}>{packageName}</p>}</div>
      <label className="relative block"><span className="sr-only">Cari di semua skrip</span><Search size={15} className="absolute left-3 top-3 text-zinc-500" /><input className="field w-full pl-9 pr-10" value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari di semua skrip…" />{search && <Button size="icon" variant="ghost" className="absolute right-0 top-0" aria-label="Hapus pencarian" onClick={() => setSearch('')}><X size={14} /></Button>}</label>
      <Select aria-label="Kategori skrip" className="w-full" value={category} onValueChange={value => { setCategory(value); setFramework('all'); }} options={[{ value: 'recommended', label: `Disarankan · ${contextCategory}` }, { value: 'all', label: 'Semua skrip' }, ...categories.map(item => ({ value: item.id, label: item.label }))]} />
      {category === 'identification' && !search && <Select aria-label="Jenis pertanyaan kualifikasi" className="w-full" value={framework} onValueChange={setFramework} options={[{ value: 'all', label: 'Semua pertanyaan' }, { value: 'need', label: 'Kebutuhan' }, { value: 'pain', label: 'Hambatan' }, { value: 'gain', label: 'Manfaat yang dicari' }, { value: 'dream', label: 'Harapan' }, { value: 'qualification', label: 'Informasi praktis' }]} />}
    </header>
    <div className="thin-scrollbar flex-1 space-y-4 overflow-y-auto p-4">
      {category === 'recommended' && !search && <div className="space-y-1 text-xs leading-relaxed text-zinc-600"><p className="flex items-center gap-1 font-semibold text-zinc-800"><Sparkles size={14} />Pilihan berdasarkan tahap prospek</p><p>Template pendamping CS. Sesuaikan dengan pertanyaan jamaah; percakapan tidak dianalisis otomatis.</p>{objection && <p>Keberatan tercatat: {objection}</p>}</div>}
      {scripts.isLoading ? <p role="status" className="text-sm text-zinc-600">Memuat pustaka skrip…</p> : scripts.isError ? <div role="alert" className="space-y-2 text-sm"><p>Skrip tidak dapat dimuat. Silakan coba lagi.</p><Button variant="secondary" onClick={() => void scripts.refetch()}>Coba lagi</Button></div> : <>
        <p role="status" className="text-xs text-zinc-600">{filtered.length} skrip{search ? ' dari semua kategori' : ''}</p>
        {filtered.length === 0 && <div className="space-y-2 text-sm text-zinc-600"><p>Tidak ada skrip yang sesuai.</p><Button variant="secondary" onClick={() => { setSearch(''); setCategory('all'); setFramework('all'); }}>Lihat semua skrip</Button></div>}
        {filtered.map(item => <article key={item.key} className="space-y-3 border-b border-zinc-200 pb-4">
          <div><p className="mb-1 text-xs text-zinc-600">{item.categoryLabel}</p><h3 className="text-sm font-semibold leading-snug">{item.title}</h3>{item.use_when && <p className="mt-1 text-xs leading-relaxed text-zinc-600">{item.use_when}</p>}</div>
          {item.steps?.length ? <div className="space-y-3"><p className="text-xs text-zinc-600">Gunakan satu langkah, lalu tunggu respons jamaah.</p>{item.steps.map((step: any, index: number) => <div key={`${item.key}:${index}`} className="space-y-2 border-l-2 border-zinc-200 pl-3"><h4 className="text-xs font-semibold">{index + 1}. {step.name}</h4><p className="whitespace-pre-line text-sm leading-relaxed">{step.text}</p><Button size="sm" variant="secondary" onClick={() => { setCopyError(''); setReview({ title: item.title, text: step.text, step: step.name }); }}>Tinjau langkah {step.name.toLowerCase()}</Button></div>)}</div> : <><p className="whitespace-pre-line text-sm leading-relaxed text-zinc-700">{item.script}</p><Button variant="secondary" className="w-full" onClick={() => { setCopyError(''); setReview({ title: item.title, text: item.script || '' }); }}>Tinjau & gunakan</Button></>}
        </article>)}
        {category === 'recommended' && !search && <Button variant="ghost" className="w-full" onClick={() => setCategory(recommended)}>Lihat semua skrip {contextCategory?.toLowerCase()}</Button>}
      </>}
    </div>
    <footer className="shrink-0 border-t border-zinc-200 px-4 py-3 text-xs text-zinc-600">Skrip ditambahkan ke draft. Pengiriman tetap melalui tombol WhatsApp.</footer>
    {review && <ModalFrame open onClose={() => setReview(null)} title={`Tinjau skrip: ${review.title}`}><div className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-xl border border-zinc-200 bg-white shadow-xl">
      <header className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4"><div><h3 className="text-sm font-semibold">{review.title}</h3><p className="mt-1 text-xs text-zinc-600">{prospectName}{review.step ? ` · Langkah ${review.step}` : ''}</p></div><Button variant="ghost" size="icon" aria-label="Tutup tinjauan skrip" onClick={() => setReview(null)}><X size={16} /></Button></header>
      <div className="space-y-3 overflow-y-auto p-4"><p className="text-xs leading-relaxed text-zinc-600">Periksa nama, kebutuhan, dan fakta paket sebelum digunakan. Ubah bagian yang belum sesuai.</p><label className="panel-field"><span>Draft balasan untuk jamaah</span><textarea className="field min-h-52 w-full py-3 text-sm" rows={10} value={review.text} onChange={event => setReview({ ...review, text: event.target.value })} /></label>{unresolvedScript(review.text) && <p role="alert" className="text-xs text-amber-800">Lengkapi semua penanda informasi yang belum dikonfirmasi sebelum memakai skrip.</p>}{copyError && <p role="alert" className="text-xs text-rose-700">{copyError}</p>}</div>
      <footer className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 p-4"><Button variant="secondary" disabled={!review.text.trim() || unresolvedScript(review.text)} icon={<Copy size={14} />} onClick={() => void copy(review.text)}>Salin</Button><Button disabled={!review.text.trim() || unresolvedScript(review.text)} icon={<CornerDownLeft size={14} />} onClick={() => { onInsertText(review.text.trim()); setReview(null); }}>Tambahkan ke draft</Button></footer>
    </div></ModalFrame>}
  </div>;
}
