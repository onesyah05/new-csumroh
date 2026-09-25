import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, Copy, CornerDownLeft, Search, Sparkles, X } from 'lucide-react';
import { objectionLabel } from '@csumroh/shared-types';
import { draftWarnings, OBJECTION_SCRIPT_CATEGORIES, unresolvedScript, useScriptLibrary, whatsappSegments, type ScriptStatus } from './scriptLibrary';
export { unresolvedScript } from './scriptLibrary';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { Modal } from '../../components/ui/modal';
import { cn } from '../../lib/cn';

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
const statusRank: Record<ScriptStatus, number> = { ready: 0, needs_context: 1, blocked: 2 };

/** Sumber teks yang sedang ditinjau, agar draft bisa disegarkan dari data terbaru tanpa menimpa suntingan CS. */
type ReviewSource = { key: string; step?: number; variant?: number };
type Review = { title: string; text: string; original: string; step?: string; source: ReviewSource; version?: string };

interface Props {
  prospectId?: number | null; revision?: string | null;
  prospectName?: string; packageId?: number | null; packageName?: string; brandId?: number;
  brandName?: string; query?: string; stage?: string; objectionCategory?: string | null; objection?: string;
  onInsertText(text: string): void; onShowToast(message: string): void;
}
export function ChatCopilotPanel({ prospectId, revision, prospectName = 'Bapak/Ibu', packageId, packageName, brandId, brandName, query = '', stage, objectionCategory, objection, onInsertText, onShowToast }: Props) {
  const complete = ['deal', 'closed_won'].includes(stage || '');
  const [category, setCategory] = useState('recommended');
  const [search, setSearch] = useState('');
  const [framework, setFramework] = useState('all');
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [copyError, setCopyError] = useState('');
  const scripts = useScriptLibrary({ brandId, prospectId, revision, packageId, query, enabled: !complete });
  const context = scripts.data?.context;
  const recommended = recommendedCategory(stage);
  const objectionFocus = stage === 'objection' && objectionCategory ? OBJECTION_SCRIPT_CATEGORIES[objectionCategory] : undefined;
  const items = useMemo(() => categories.flatMap(cat => (scripts.data?.categories?.[cat.id]?.scripts ?? []).map((item: any, index: number) => ({
    ...item, status: (item.status ?? 'ready') as ScriptStatus, reasons: (item.reasons ?? []) as string[],
    categoryId: cat.id, categoryLabel: cat.label, key: `${cat.id}:${item.id || index}`,
  }))), [scripts.data]);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('id-ID');
    if (term) return items.filter(item => `${item.title} ${item.script} ${item.use_when} ${item.steps?.flatMap((step: any) => [step.text, ...(step.variants ?? []).map((v: any) => v.text)]).join(' ') || ''}`.toLocaleLowerCase('id-ID').includes(term));
    if (category === 'recommended') {
      // Sesuai tahap: hanya yang bisa dipakai sekarang, yang siap dulu; keberatan tercatat mempersempit pilihan (S09, S12).
      return items
        .filter(item => item.categoryId === recommended && item.status !== 'blocked')
        .filter(item => !objectionFocus || objectionFocus.includes(item.category))
        .sort((a, b) => statusRank[a.status as ScriptStatus] - statusRank[b.status as ScriptStatus])
        .slice(0, 3);
    }
    return items.filter(item => {
      if (category !== 'all' && item.categoryId !== category) return false;
      return category !== 'identification' || framework === 'all' || (item.npgd?.code || item.category) === framework;
    });
  }, [items, category, framework, search, recommended, objectionFocus]);

  // Data prospek/paket berubah saat draft terbuka: draft yang belum disunting ikut diperbarui; yang sudah disunting
  // tidak ditimpa, CS diberi tahu dan bisa memuat ulang (S13).
  const latest = review ? textFor(items, review.source) : undefined;
  const stale = Boolean(review && latest !== undefined && review.version && context?.version && review.version !== context.version && latest !== review.original);
  useEffect(() => {
    if (!review || !stale || latest === undefined || review.text !== review.original) return;
    setReview({ ...review, text: latest, original: latest, version: context?.version });
  }, [stale, latest, review, context?.version]);

  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setCopyError(''); onShowToast('Skrip tersalin. Belum dikirim ke jamaah.'); } catch { setCopyError('Clipboard tidak tersedia. Pilih teks lalu salin secara manual.'); } }
  function open(title: string, text: string, source: ReviewSource, step?: string) {
    setCopyError('');
    setReview({ title, text, original: text, step, source, version: context?.version });
  }

  function renderSteps(item: any, blocked: boolean) {
    return item.steps.map((step: any, index: number) => {
      const choiceKey = `${item.key}:${index}`;
      const variants: any[] = step.variants ?? [];
      const picked = choices[choiceKey];
      const variant = step.choose === 'reason' ? (picked === undefined ? undefined : variants[picked]) : variants[picked ?? 0];
      const text: string = variant?.text ?? (step.choose === 'reason' ? '' : step.text);
      const stepBlocked = Boolean(variant?.blocked);
      return <div key={choiceKey} className="space-y-2 border-l-2 border-zinc-200 pl-3">
        <h4 className="text-xs font-semibold">{index + 1}. {step.name}</h4>
        {step.choose === 'reason'
          ? <Select aria-label={`Alasan jamaah untuk ${item.title}`} className="w-full" placeholder="Pilih alasan yang ditemukan saat menggali" value={picked === undefined ? undefined : String(picked)} onValueChange={value => setChoices({ ...choices, [choiceKey]: Number(value) })} options={variants.map((option, i) => ({ value: String(i), label: option.label }))} />
          : null}
        {text && <WhatsAppText text={text} className="text-sm leading-relaxed" />}
        {stepBlocked && <p className="text-xs text-zinc-600">Belum bisa dipakai: data {variant.missing.map((gap: any) => gap.label).join(', ')} belum tersedia.</p>}
        {text && <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="secondary" disabled={blocked || stepBlocked} onClick={() => open(item.title, text, { key: item.key, step: index, variant: step.choose === 'reason' ? picked : picked ?? 0 }, step.name)}>Tinjau langkah {step.name.toLowerCase()}</Button>
          {step.choose !== 'reason' && variants.length > 1 && <Button size="sm" variant="ghost" aria-label={`Variasi ${step.name.toLowerCase()} lain untuk ${item.title}`} onClick={() => setChoices({ ...choices, [choiceKey]: ((picked ?? 0) + 1) % variants.length })}>Variasi lain ({(picked ?? 0) + 1}/{variants.length})</Button>}
        </div>}
      </div>;
    });
  }
  const contextCategory = categories.find(item => item.id === recommended)?.label;
  if (complete) return <div className="sales-panel space-y-2 p-4"><h2 className="text-sm font-semibold">Deal terverifikasi</h2><p className="text-sm leading-relaxed text-zinc-600">Penanganan CS untuk {prospectName} selesai. Administrasi pembayaran berikutnya ditangani di luar CRM.</p></div>;
  const warnings: string[] = context?.warnings ?? [];
  const editorial = review ? draftWarnings(review.text) : [];
  const unresolved = review ? unresolvedScript(review.text) : false;

  return <div className="sales-panel flex h-full min-h-0 flex-col bg-white">
    <header className="shrink-0 space-y-3 border-b border-zinc-200 p-4">
      <div><h2 className="text-sm font-semibold">Bantuan percakapan</h2><p className="mt-1 break-words text-xs text-zinc-600">{prospectName} · {brandName || 'Brand aktif'}</p>{packageName && <p className="mt-1 line-clamp-2 text-xs text-zinc-600" title={packageName}>{packageName}</p>}</div>
      <label className="relative block"><span className="sr-only">Cari di semua skrip</span><Search size={15} className="absolute left-3 top-3 text-zinc-500" /><input className="field w-full pl-9 pr-10" value={search} onChange={event => setSearch(event.target.value)} placeholder="Cari di semua skrip…" />{search && <Button size="icon" variant="ghost" className="absolute right-0 top-0" aria-label="Hapus pencarian" onClick={() => setSearch('')}><X size={14} /></Button>}</label>
      <Select aria-label="Kategori skrip" className="w-full" value={category} onValueChange={value => { setCategory(value); setFramework('all'); }} options={[{ value: 'recommended', label: `Sesuai tahap prospek · ${contextCategory}` }, { value: 'all', label: 'Semua skrip' }, ...categories.map(item => ({ value: item.id, label: item.label }))]} />
      {category === 'identification' && !search && <Select aria-label="Jenis pertanyaan kualifikasi" className="w-full" value={framework} onValueChange={setFramework} options={[{ value: 'all', label: 'Semua pertanyaan' }, { value: 'need', label: 'Kebutuhan' }, { value: 'pain', label: 'Hambatan' }, { value: 'gain', label: 'Manfaat yang dicari' }, { value: 'dream', label: 'Harapan' }, { value: 'qualification', label: 'Informasi praktis' }]} />}
    </header>
    <div className="thin-scrollbar flex-1 space-y-4 overflow-y-auto p-4">
      {warnings.length > 0 && <ul className="space-y-1 text-xs leading-relaxed text-amber-800">{warnings.map(text => <li key={text} className="flex gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />{text}</li>)}</ul>}
      {category === 'recommended' && !search && <div className="space-y-1 text-xs leading-relaxed text-zinc-600"><p className="flex items-center gap-1 font-semibold text-zinc-800"><Sparkles size={14} />Skrip yang datanya sudah tersedia</p>{stage === 'objection' && <p>Keberatan tercatat: {objectionCategory ? objectionLabel(objectionCategory) : objection || 'belum dipilih'}</p>}</div>}
      {scripts.isLoading ? <p role="status" className="text-sm text-zinc-600">Memuat pustaka skrip…</p> : scripts.isError ? <div role="alert" className="space-y-2 text-sm"><p>Skrip tidak dapat dimuat. Silakan coba lagi.</p><Button variant="secondary" onClick={() => void scripts.refetch()}>Coba lagi</Button></div> : <>
        <p role="status" className="text-xs text-zinc-600">{filtered.length} skrip{search ? ' dari semua kategori' : ''}</p>
        {filtered.length === 0 && <div className="space-y-2 text-sm text-zinc-600"><p>{category === 'recommended' ? 'Belum ada skrip tahap ini yang datanya lengkap.' : 'Tidak ada skrip yang sesuai.'}</p><Button variant="secondary" onClick={() => { setSearch(''); setCategory(category === 'recommended' ? recommended : 'all'); setFramework('all'); }}>{category === 'recommended' ? `Lihat semua skrip ${contextCategory?.toLowerCase()}` : 'Lihat semua skrip'}</Button></div>}
        {filtered.map(item => {
          const blocked = item.status === 'blocked';
          const reasons = item.reasons.length > 0 && <p className={cn('mt-1 text-xs leading-relaxed', blocked ? 'text-zinc-600' : 'text-amber-800')}>{blocked ? 'Belum bisa dipakai: ' : 'Perlu dicek: '}{item.reasons.join(' · ')}</p>;
          // Keberatan (TGJP) tampil sebagai akordeon: CS memindai ucapan jamaah dulu, baru membuka langkahnya.
          if (item.steps?.length) {
            const isOpen = expanded === item.key || filtered.filter(entry => entry.steps?.length).length === 1;
            const panelId = `tgjp-${item.key.replace(/[^a-z0-9_-]/gi, '-')}`;
            return <article key={item.key} className="border-b border-zinc-200">
              <h3><button type="button" aria-expanded={isOpen} aria-controls={panelId} onClick={() => setExpanded(isOpen ? null : item.key)} className="flex w-full items-start gap-2 py-3 text-left">
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm font-semibold leading-snug', blocked && 'text-zinc-500')}>{item.title}</span>
                  {item.use_when && <span className="mt-0.5 block text-xs leading-relaxed text-zinc-600">{item.use_when}</span>}
                </span>
                <ChevronDown size={16} aria-hidden="true" className={cn('mt-0.5 shrink-0 text-zinc-500 transition-transform', isOpen && 'rotate-180')} />
              </button></h3>
              {isOpen && <div id={panelId} className="space-y-3 pb-4">
                {reasons}
                <p className="text-xs text-zinc-600">Gunakan satu langkah, lalu tunggu respons jamaah.</p>
                {renderSteps(item, blocked)}
              </div>}
            </article>;
          }
          return <article key={item.key} className="space-y-3 border-b border-zinc-200 pb-4">
            <div>
              <p className="mb-1 text-xs text-zinc-600">{item.categoryLabel}</p>
              <h3 className={cn('text-sm font-semibold leading-snug', blocked && 'text-zinc-500')}>{item.title}</h3>
              {item.use_when && <p className="mt-1 text-xs leading-relaxed text-zinc-600">{item.use_when}</p>}
              {reasons}
            </div>
            <WhatsAppText text={item.script || ''} className={cn('text-sm leading-relaxed', blocked ? 'text-zinc-500' : 'text-zinc-700')} /><Button variant="secondary" className="w-full" disabled={blocked} onClick={() => open(item.title, item.script || '', { key: item.key })}>Tinjau & gunakan</Button>
          </article>;
        })}
        {category === 'recommended' && !search && filtered.length > 0 && <Button variant="ghost" className="w-full" onClick={() => setCategory(recommended)}>Lihat semua skrip {contextCategory?.toLowerCase()}</Button>}
      </>}
    </div>
    <footer className="shrink-0 border-t border-zinc-200 px-4 py-3 text-xs text-zinc-600">Skrip ditambahkan ke draft. Pengiriman tetap melalui tombol WhatsApp.</footer>
    {review && <Modal open onClose={() => setReview(null)} size="md" title={review.title} description={`${prospectName}${review.step ? ` · Langkah ${review.step}` : ''}`}
      footer={<><Button variant="secondary" disabled={!review.text.trim() || unresolved} icon={<Copy size={14} />} onClick={() => void copy(review.text)}>Salin</Button><Button disabled={!review.text.trim() || unresolved} icon={<CornerDownLeft size={14} />} onClick={() => { onInsertText(review.text.trim()); setReview(null); }}>Tambahkan ke draft</Button></>}>
      <div className="space-y-3">
        {stale && review.text !== review.original && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900"><span>Data paket atau prospek baru berubah. Angka di draft ini mungkin sudah tidak sesuai.</span><Button size="sm" variant="secondary" onClick={() => setReview({ ...review, text: latest!, original: latest!, version: context?.version })}>Pakai teks terbaru</Button></div>}
        <div className="rounded-xl bg-[#efeae2] p-3" aria-label="Pratinjau di WhatsApp">
          <div className="ml-auto w-fit max-w-[92%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-2 shadow-xs">
            <WhatsAppText text={review.text.trim() || ' '} className="text-[13.5px] leading-snug text-zinc-900" />
          </div>
        </div>
        <div className="space-y-1"><label className="panel-field"><span>Draft balasan untuk jamaah</span><textarea className="field min-h-40 w-full py-3 text-sm" rows={8} value={review.text} onChange={event => setReview({ ...review, text: event.target.value })} /></label><p className={cn('text-right text-xs tabular-nums', review.text.length > 450 ? 'text-amber-800' : 'text-zinc-500')}>{review.text.length} karakter</p></div>
        {editorial.length > 0 && <ul className="space-y-1 text-xs text-amber-800" role={unresolved ? 'alert' : undefined}>{editorial.map(text => <li key={text}>{text}</li>)}</ul>}
        {copyError && <p role="alert" className="text-xs text-rose-700">{copyError}</p>}
      </div>
    </Modal>}
  </div>;
}

function textFor(items: any[], source: ReviewSource): string | undefined {
  const item = items.find(entry => entry.key === source.key);
  if (!item) return undefined;
  if (source.step === undefined) return item.script;
  const step = item.steps?.[source.step];
  return step?.variants?.[source.variant ?? 0]?.text ?? step?.text;
}

/** Teks dengan tebal WhatsApp (*teks*) seperti yang akan terlihat di ponsel jamaah. */
function WhatsAppText({ text, className }: { text: string; className?: string }) {
  return <p className={cn('whitespace-pre-line break-words', className)}>{whatsappSegments(text).map((part, index) => part.bold ? <strong key={index} className="font-semibold">{part.text}</strong> : <Fragment key={index}>{part.text}</Fragment>)}</p>;
}
