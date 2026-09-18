import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowUp,
  Bot,
  Check,
  CheckCheck,
  CircleUserRound,
  Clipboard,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  Search,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useBrandScope } from '../../lib/scope';
import { queryClient } from '../../app/query';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { PageError, PageLoading } from '../../components/ui/page-feedback';

const copilotTabs = [
  { id: 'greeting', label: 'Sapaan' },
  { id: 'identification', label: 'Identifikasi' },
  { id: 'offer', label: 'Penawaran' },
  { id: 'objection', label: 'Keberatan' },
  { id: 'followups', label: 'Follow-up' },
  { id: 'closing', label: 'Closing' },
] as const;

type CopilotTab = (typeof copilotTabs)[number]['id'];

const statusToTab: Record<string, CopilotTab> = {
  new: 'greeting',
  identifying: 'identification',
  offered: 'offer',
  objection: 'objection',
  followup: 'followups',
  nurture: 'followups',
  closing: 'closing',
  closed_won: 'closing',
  closed_lost: 'followups',
};

export function InboxPage() {
  const { brandId, query } = useBrandScope();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [copilotTab, setCopilotTab] = useState<CopilotTab>('greeting');
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const conversations = useQuery({
    queryKey: ['conversations', brandId],
    queryFn: () => api.get<any[]>(`/chat/conversations${query}`),
    enabled: !!brandId,
  });

  useEffect(() => {
    if (!selectedId && conversations.data?.[0]) setSelectedId(conversations.data[0].id);
  }, [conversations.data, selectedId]);

  const selected = conversations.data?.find((item) => item.id === selectedId);

  useEffect(() => {
    if (selected?.status) setCopilotTab(statusToTab[selected.status] ?? 'greeting');
  }, [selected?.id, selected?.status]);

  const messages = useQuery({
    queryKey: ['messages', selectedId, brandId],
    queryFn: () => api.get<any[]>(`/chat/prospects/${selectedId}/messages${query}`),
    enabled: !!selectedId && !!brandId,
  });

  const separator = query ? '&' : '?';
  const copilot = useQuery({
    queryKey: ['inbox-copilot', brandId, selected?.id, selected?.packageId],
    queryFn: () => api.get<any>(
      `/scripts${query}${separator}nama=${encodeURIComponent(selected?.name ?? '')}${selected?.packageId ? `&packageId=${selected.packageId}` : ''}`,
    ),
    enabled: !!brandId && !!selected,
  });

  const scripts = (copilot.data?.categories?.[copilotTab]?.scripts ?? []) as any[];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.data]);

  const send = useMutation({
    mutationFn: (text: string) => api.post('/chat/messages', { prospectId: selectedId, text }),
    onSuccess: () => {
      setMessage('');
      void queryClient.invalidateQueries({ queryKey: ['messages', selectedId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const filtered = useMemo(
    () => conversations.data?.filter((item) => `${item.name} ${item.phone}`.toLowerCase().includes(search.toLowerCase())) ?? [],
    [conversations.data, search],
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (message.trim() && !send.isPending) send.mutate(message.trim());
  }

  function useScript(script: string) {
    setMessage(script);
    setCopilotOpen(false);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  async function copyScript(id: string, script: string) {
    await navigator.clipboard.writeText(script);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1600);
  }

  if (!brandId) return <PageError title="Belum ada brand aktif" description="Buat brand melalui menu Administrasi dan hubungkan WhatsApp untuk menerima percakapan sebenarnya." />;
  if (conversations.isLoading) return <PageLoading label="Membuka kotak masuk" />;
  if (conversations.isError) return <PageError description={conversations.error.message} onRetry={() => void conversations.refetch()} />;

  return (
    <div className="relative -m-4 h-[calc(100vh-4rem)] overflow-hidden bg-white sm:-m-6 lg:-m-8">
      {copilotOpen && (
        <button
          aria-label="Tutup Copilot"
          className="inbox-copilot-backdrop"
          onClick={() => setCopilotOpen(false)}
        />
      )}

      <div className="inbox-workspace">
        <aside className="inbox-conversation-list flex flex-col border-r bg-zinc-50/60">
          <div className="border-b p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-extrabold tracking-tight">Kotak masuk</h2>
                <p className="text-[11px] text-zinc-400">{filtered.length} percakapan aktif</p>
              </div>
              <Button size="icon" variant="secondary"><MessageSquareText size={16} /></Button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-zinc-400" size={15} />
              <input className="h-9 w-full rounded-xl border bg-white pl-9 pr-3 text-xs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari jamaah…" />
            </div>
          </div>

          <div className="thin-scrollbar flex-1 overflow-y-auto">
            {filtered.map((item) => {
              const last = item.messages?.[0];
              const active = item.id === selectedId;
              return (
                <button key={item.id} onClick={() => setSelectedId(item.id)} className={cn('flex w-full gap-3 border-b px-4 py-4 text-left transition', active ? 'bg-white shadow-[inset_3px_0_0_#18181b]' : 'hover:bg-white')}>
                  <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-700">
                    {String(item.name ?? '?').slice(0, 2).toUpperCase()}
                    <i className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-600" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <b className="truncate text-sm">{item.name}</b>
                      <time className="shrink-0 text-[9px] text-zinc-400">{last ? new Date(last.timestamp * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : 'Baru'}</time>
                    </span>
                    <span className="mt-1 block truncate text-xs text-zinc-500">{last?.isFromMe ? 'Anda: ' : ''}{last?.messageText ?? 'Mulai percakapan baru'}</span>
                    <span className="mt-2 flex items-center justify-between gap-2">
                      <Badge value={item.status} className="px-2 py-0.5 text-[8px]" />
                      <span className="truncate text-[9px] text-zinc-400">{item.user?.name ?? 'Belum ada PIC'}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="inbox-chat flex flex-col bg-white">
          {selected ? (
            <>
              <header className="flex h-[73px] items-center gap-3 border-b px-4 sm:px-5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-zinc-100 text-xs font-bold">{String(selected.name ?? '?').slice(0, 2).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-bold">{selected.name}</h3>
                  <p className="flex items-center gap-1 text-[10px] text-zinc-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-600" /> WhatsApp · {selected.phone}</p>
                </div>
                <Button variant="secondary" size="sm" className="inbox-copilot-trigger" onClick={() => setCopilotOpen(true)}><Bot size={15} />Copilot</Button>
                <Link to={`/prospects/${selected.id}`}><Button variant="secondary" size="sm" className="hidden sm:inline-flex"><CircleUserRound size={15} />Profil</Button></Link>
                <Button variant="ghost" size="icon"><MoreHorizontal size={18} /></Button>
              </header>

              <div className="thin-scrollbar flex-1 overflow-y-auto bg-[radial-gradient(#d4d4d8_.7px,transparent_.7px)] bg-[size:18px_18px] px-4 py-6 sm:px-6">
                <div className="mx-auto max-w-3xl space-y-3">
                  <div className="mb-5 text-center"><span className="rounded-full border bg-white px-3 py-1 text-[10px] font-medium text-zinc-400 shadow-sm">Percakapan terenkripsi end-to-end oleh WhatsApp</span></div>
                  {messages.isLoading && <div className="space-y-3" role="status" aria-label="Memuat percakapan"><div className="h-16 w-2/3 animate-pulse rounded-2xl bg-zinc-100"/><div className="ml-auto h-20 w-3/4 animate-pulse rounded-2xl bg-zinc-200"/><div className="h-14 w-1/2 animate-pulse rounded-2xl bg-zinc-100"/></div>}
                  {messages.isError && <div className="mx-auto max-w-sm rounded-2xl border bg-white p-5 text-center"><p className="text-sm font-bold">Pesan gagal dimuat</p><button className="mt-2 text-xs font-semibold underline" onClick={() => void messages.refetch()}>Coba lagi</button></div>}
                  {messages.data?.map((item) => (
                    <div key={item.id} className={cn('flex', item.isFromMe ? 'justify-end' : 'justify-start')}>
                      <div className={cn('max-w-[84%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm', item.isFromMe ? 'rounded-br-md bg-zinc-950 text-white' : 'rounded-bl-md border bg-white text-zinc-800')}>
                        <p className="whitespace-pre-wrap leading-5">{item.messageText || `[${item.messageType}]`}</p>
                        <span className={cn('mt-1.5 flex items-center justify-end gap-1 text-[9px]', item.isFromMe ? 'text-zinc-500' : 'text-zinc-400')}>
                          {new Date(item.timestamp * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}{item.isFromMe && <CheckCheck size={12} />}
                        </span>
                      </div>
                    </div>
                  ))}
                  <div ref={endRef} />
                </div>
              </div>

              <form onSubmit={submit} className="border-t bg-white p-3 sm:p-4">
                <div className="mx-auto flex max-w-3xl items-end gap-2">
                  <Button type="button" size="icon" variant="ghost"><Paperclip size={18} /></Button>
                  <textarea
                    ref={composerRef}
                    rows={1}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    placeholder="Tulis pesan atau pilih skrip Copilot…"
                    className="min-h-11 max-h-32 flex-1 resize-none rounded-xl border bg-zinc-50 px-3 py-3 text-sm"
                  />
                  <Button size="icon" disabled={!message.trim() || send.isPending} aria-label="Kirim pesan"><ArrowUp size={18} /></Button>
                </div>
                {send.error && <p className="mx-auto mt-2 max-w-3xl text-xs text-zinc-500">{send.error.message}</p>}
              </form>
            </>
          ) : (
            <div className="grid h-full place-items-center text-center"><div><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-zinc-100"><MessageSquareText size={24} /></span><h3 className="mt-4 font-display font-bold">Pilih percakapan</h3><p className="mt-1 text-sm text-zinc-400">Riwayat pesan akan muncul di sini.</p></div></div>
          )}
        </section>

        <CopilotPanel
          selected={selected}
          activeTab={copilotTab}
          onTabChange={setCopilotTab}
          scripts={scripts}
          loading={copilot.isLoading}
          copiedId={copiedId}
          open={copilotOpen}
          onClose={() => setCopilotOpen(false)}
          onUse={useScript}
          onCopy={(id, script) => void copyScript(id, script)}
        />
      </div>
    </div>
  );
}

function CopilotPanel({
  selected,
  activeTab,
  onTabChange,
  scripts,
  loading,
  copiedId,
  open,
  onClose,
  onUse,
  onCopy,
}: {
  selected: any;
  activeTab: CopilotTab;
  onTabChange(tab: CopilotTab): void;
  scripts: any[];
  loading: boolean;
  copiedId: string | null;
  open: boolean;
  onClose(): void;
  onUse(script: string): void;
  onCopy(id: string, script: string): void;
}) {
  return (
    <aside className={cn(
      'inbox-copilot flex-col border-l bg-zinc-50',
      open && 'is-open animate-slide-in',
    )}>
      <header className="flex h-[73px] shrink-0 items-center gap-3 border-b bg-white px-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-zinc-950 text-white"><WandSparkles size={18} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-sm font-extrabold">Copilot percakapan</h3>
          <p className="truncate text-[10px] text-zinc-400">Skrip untuk {selected?.name ?? 'jamaah terpilih'}</p>
        </div>
        <button className="inbox-copilot-close rounded-lg p-2 text-zinc-500 hover:bg-zinc-100" onClick={onClose}><X size={18} /></button>
      </header>

      {selected ? (
        <>
          <div className="shrink-0 border-b bg-white px-3 pb-3 pt-3">
            <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
              <div className="min-w-0">
                <p className="truncate text-xs font-bold">{selected.name}</p>
                <p className="mt-0.5 truncate text-[9px] text-zinc-500">{selected.package?.name ?? 'Paket belum dipilih'}</p>
              </div>
              <Badge value={selected.status} className="shrink-0 px-2 py-0.5 text-[8px]" />
            </div>
            <div className="thin-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
              {copilotTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className={cn('shrink-0 rounded-lg border px-3 py-2 text-[10px] font-bold transition', activeTab === tab.id ? 'border-zinc-950 bg-zinc-950 text-white' : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400 hover:text-zinc-950')}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
            <div className="mb-3 flex items-center justify-between px-1">
              <p className="text-[10px] font-bold uppercase tracking-[.12em] text-zinc-400">Rekomendasi skrip</p>
              <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[9px] font-bold text-zinc-600">{scripts.length}</span>
            </div>

            <div className="space-y-2.5">
              {loading && [1, 2, 3].map((item) => <div key={item} className="h-40 animate-pulse rounded-2xl border bg-zinc-100" />)}
              {!loading && scripts.map((script, index) => (
                <article key={script.id ?? index} className="rounded-xl border bg-white p-3 shadow-sm transition hover:border-zinc-400">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[9px] font-bold uppercase tracking-[.1em] text-zinc-400">{script.category?.replaceAll('_', ' ') ?? 'Rekomendasi'}</p>
                      <h4 className="mt-1 text-xs font-bold leading-5 text-zinc-900">{script.title}</h4>
                    </div>
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-zinc-100 text-[9px] font-extrabold">{String(index + 1).padStart(2, '0')}</span>
                  </div>
                  {script.use_when && <p className="mt-1.5 line-clamp-1 text-[10px] leading-4 text-zinc-400">{script.use_when}</p>}
                  <div className="mt-2.5 rounded-lg bg-zinc-50 p-2.5">
                    <p className="line-clamp-4 whitespace-pre-wrap text-[11px] leading-[1.55] text-zinc-600">{script.script}</p>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Button size="sm" className="flex-1" onClick={() => onUse(script.script)}><Sparkles size={13} />Pakai skrip</Button>
                    <Button size="icon" variant="secondary" className="h-9 w-9" onClick={() => onCopy(script.id ?? String(index), script.script)} aria-label="Salin skrip">
                      {copiedId === (script.id ?? String(index)) ? <Check size={14} /> : <Clipboard size={14} />}
                    </Button>
                  </div>
                </article>
              ))}
              {!loading && !scripts.length && (
                <div className="rounded-2xl border border-dashed p-7 text-center">
                  <Bot className="mx-auto text-zinc-400" size={22} />
                  <p className="mt-3 text-xs font-bold">Belum ada skrip</p>
                  <p className="mt-1 text-[10px] leading-4 text-zinc-400">Pilih tab percakapan lain untuk melihat rekomendasi.</p>
                </div>
              )}
            </div>
          </div>

          <footer className="shrink-0 border-t bg-white p-3">
            <div className="flex items-center gap-2 rounded-xl bg-zinc-950 px-3 py-2.5 text-white">
              <Sparkles size={14} className="shrink-0 text-zinc-400" />
              <p className="text-[9px] leading-4 text-zinc-400">Skrip sudah dipersonalisasi sesuai jamaah, brand, dan paket.</p>
            </div>
          </footer>
        </>
      ) : (
        <div className="grid flex-1 place-items-center p-8 text-center"><div><Bot className="mx-auto text-zinc-400" /><p className="mt-3 text-xs font-bold">Pilih percakapan</p><p className="mt-1 text-[10px] text-zinc-400">Copilot akan menyesuaikan rekomendasi.</p></div></div>
      )}
    </aside>
  );
}
