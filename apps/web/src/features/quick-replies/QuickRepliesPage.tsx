import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquareText, Pencil, Plus, Search, Smile, Trash2 } from 'lucide-react';
import {
  QUICK_REPLY_BODY_MAX, QUICK_REPLY_SHORTCUT_MAX, QUICK_REPLY_SUGGESTED_TOKENS, QUICK_REPLY_TITLE_MAX,
  type QuickReplyScope,
} from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useAuth } from '../../app/auth';
import { useBrandScope } from '../../lib/scope';
import { showFeedback } from '../../app/toast';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/modal';
import { onRovingKey, rovingTabIndex } from '../../lib/roving';
import { EmptyState, PageError, PageLoading } from '../../components/ui/page-feedback';
import { PageHeader } from '../../components/ui/page-header';
import { Pager } from '../../components/ui/pager';
import { EmojiPicker } from '../chat/EmojiPicker';
import { RowActions } from '../../components/ui/row-actions';
import { QUICK_REPLIES_KEY, useQuickReplies, type QuickReply } from './quickRepliesApi';

interface Draft { id: number | null; scope: QuickReplyScope; title: string; shortcut: string; body: string }
const emptyDraft = (scope: QuickReplyScope): Draft => ({ id: null, scope, title: '', shortcut: '', body: '' });
const SCOPE_VALUES: readonly QuickReplyScope[] = ['brand', 'personal'];
const PAGE_SIZE = 10;

const draftOf = (item: QuickReply): Draft => ({ id: item.id, scope: item.scope, title: item.title, shortcut: item.shortcut ?? '', body: item.body });

/** Pilihan cakupan Brand/Pribadi: tab di daftar dan radio di formulir memakai satu markup. */
// Baris kosong tidak boleh menghabiskan jatah dua baris pratinjau; pesan asli tetap utuh.
const previewBody = (body: string) => body.replace(/\n{2,}/g, '\n');

function ScopeSwitch({ value, onChange, kind, labels, className }: {
  value: QuickReplyScope;
  onChange(value: QuickReplyScope): void;
  kind: 'tab' | 'radio';
  labels: Record<QuickReplyScope, string>;
  className?: string;
}) {
  return (
    <div
      role={kind === 'tab' ? 'tablist' : 'radiogroup'}
      aria-label={kind === 'tab' ? 'Cakupan balas cepat' : 'Cakupan'}
      className={cn('segmented flex gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-0.5', className)}
      onKeyDown={(event) => onRovingKey(event, SCOPE_VALUES, value, onChange)}
    >
      {SCOPE_VALUES.map((scope) => (
        <button
          key={scope}
          type="button"
          role={kind === 'tab' ? 'tab' : 'radio'}
          {...(kind === 'tab' ? { 'aria-selected': value === scope } : { 'aria-checked': value === scope })}
          tabIndex={rovingTabIndex(scope, value, 'brand')}
          onClick={() => onChange(scope)}
          className={cn('flex-1 rounded-lg px-4 py-1.5 text-xs font-semibold transition sm:flex-none', value === scope ? 'bg-white text-zinc-950 shadow-xs' : 'text-zinc-600 hover:text-zinc-900')}
        >
          {labels[scope]}
        </button>
      ))}
    </div>
  );
}

/** Kelola balas cepat: template brand (semua staf brand) dan pribadi. CS memakainya dengan mengetik "/" di chat. */
export function QuickRepliesPage() {
  const { user } = useAuth();
  const { brandId } = useBrandScope();
  const queryClient = useQueryClient();
  const list = useQuickReplies(brandId);
  const [tab, setTab] = useState<QuickReplyScope>('brand');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<QuickReply | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const isManager = user?.role === 'admin' || user?.role === 'superadmin';

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data ?? []).filter((item) =>
      item.scope === tab && (!q || `${item.title} ${item.shortcut ?? ''} ${item.body}`.toLowerCase().includes(q)));
  }, [list.data, tab, search]);
  const lastPage = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(page, lastPage);
  useEffect(() => { if (page > lastPage) setPage(lastPage); }, [page, lastPage]);
  useEffect(() => { if (!draft) setEmojiOpen(false); }, [draft]);
  const pageItems = items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: [QUICK_REPLIES_KEY] });
  const onError = (error: Error) => showFeedback(error.message, { error: true });

  const save = useMutation({
    mutationFn: (input: Draft) => input.id
      ? api.patch('/quick-replies/' + input.id, { title: input.title, shortcut: input.shortcut, body: input.body })
      : api.post('/quick-replies', { brandId, scope: input.scope, title: input.title, shortcut: input.shortcut, body: input.body }),
    onSuccess: () => { setDraft(null); refresh(); showFeedback('Balas cepat disimpan.'); },
    onError,
  });
  const remove = useMutation({
    mutationFn: (item: QuickReply) => api.delete('/quick-replies/' + item.id),
    onSuccess: () => { setRemoving(null); refresh(); showFeedback('Balas cepat dihapus.'); },
    onError,
  });

  const canDelete = (item: QuickReply) => item.scope === 'personal' ? item.ownerId === user?.id : item.ownerId === user?.id || isManager;
  const actionsFor = (item: QuickReply) => [
    { label: 'Ubah', icon: Pencil, onSelect: () => setDraft(draftOf(item)) },
    { label: 'Hapus', icon: Trash2, onSelect: () => setRemoving(item), danger: true, hidden: !canDelete(item) },
  ];
  const changeTab = (value: QuickReplyScope) => { setTab(value); setPage(1); };

  /** Sisipkan teks (token atau emoji) di posisi kursor kolom isi; baris baru tetap utuh. */
  function insertAtCaret(text: string) {
    const area = bodyRef.current;
    if (!area || !draft) return;
    const start = area.selectionStart ?? draft.body.length;
    const end = area.selectionEnd ?? draft.body.length;
    const body = draft.body.slice(0, start) + text + draft.body.slice(end);
    setDraft({ ...draft, body });
    requestAnimationFrame(() => { area.focus(); area.setSelectionRange(start + text.length, start + text.length); });
  }

  const insertToken = (token: string) => insertAtCaret('{{' + token + '}}');

  if (!brandId) return <PageError title="Brand belum dipilih" description="Pilih brand untuk mengelola balas cepat." />;
  if (list.isLoading) return <PageLoading label="Memuat balas cepat…" />;
  if (list.isError) return <PageError description={list.error.message} onRetry={() => void list.refetch()} />;

  return (
    <div className="app-page max-w-4xl">
      <PageHeader
        className="hidden md:flex"
        title="Balas cepat"
        actions={<Button icon={<Plus size={14} />} onClick={() => setDraft(emptyDraft(tab))}>Tambah</Button>}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <ScopeSwitch kind="tab" value={tab} onChange={changeTab} labels={{ brand: 'Brand', personal: 'Pribadi' }} className="sm:w-fit" />
        <div className="flex items-center gap-2 sm:flex-1">
          <div className="relative min-w-0 flex-1">
            <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
            <input
              className="field pl-9"
              placeholder="Cari judul, pintasan, atau isi"
              aria-label="Cari balas cepat"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            />
          </div>
          <Button size="icon" className="md:hidden" aria-label="Tambah balas cepat" onClick={() => setDraft(emptyDraft(tab))}>
            <Plus size={18} />
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={MessageSquareText}
          variant="section"
          title={search ? 'Balas cepat tidak ditemukan' : tab === 'brand' ? 'Belum ada balas cepat brand' : 'Belum ada balas cepat pribadi'}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <ul className="divide-y divide-zinc-100 md:hidden">
            {pageItems.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-950">{item.title}</p>
                  {item.shortcut && <p className="text-xs font-medium text-zinc-500">/{item.shortcut}</p>}
                  <p className="mt-1 line-clamp-2 whitespace-pre-line break-words text-xs leading-5 text-zinc-600">{previewBody(item.body)}</p>
                </div>
                <RowActions label={'Aksi ' + item.title} actions={actionsFor(item)} />
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-200 bg-zinc-50/75 text-xs font-semibold text-zinc-500">
                <tr>
                  <th className="w-56 px-4 py-3">Judul</th>
                  <th className="w-36 px-4 py-3">Pintasan</th>
                  <th className="px-4 py-3">Isi pesan</th>
                  <th className="w-16 px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {pageItems.map((item) => (
                  <tr key={item.id} className="hover:bg-zinc-50/60">
                    <td className="px-4 py-3 align-top font-semibold text-zinc-950">{item.title}</td>
                    <td className="px-4 py-3 align-top text-zinc-600">{item.shortcut ? '/' + item.shortcut : '-'}</td>
                    <td className="max-w-0 px-4 py-3 align-top text-zinc-700"><p className="line-clamp-2 whitespace-pre-line break-words leading-5">{previewBody(item.body)}</p></td>
                    <td className="px-4 py-3 text-right align-top"><RowActions label={'Aksi ' + item.title} actions={actionsFor(item)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={currentPage} pageSize={PAGE_SIZE} total={items.length} onPage={setPage} label="balas cepat" />
        </div>
      )}

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Ubah balas cepat' : 'Balas cepat baru'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>Batal</Button>
            <Button
              onClick={() => draft && save.mutate(draft)}
              loading={save.isPending}
              disabled={!draft || !draft.title.trim() || !draft.body.trim()}
            >
              Simpan
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            {!draft.id && (
              <ScopeSwitch kind="radio" value={draft.scope} onChange={(scope) => setDraft({ ...draft, scope })} labels={{ brand: 'Brand ini', personal: 'Pribadi' }} />
            )}
            <div>
              <label className="label" htmlFor="qr-title">Judul</label>
              <input id="qr-title" className="field" value={draft.title} maxLength={QUICK_REPLY_TITLE_MAX} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="qr-shortcut">Pintasan (opsional)</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500" aria-hidden="true">/</span>
                <input
                  id="qr-shortcut"
                  className="field pl-6"
                  value={draft.shortcut}
                  maxLength={QUICK_REPLY_SHORTCUT_MAX}
                  onChange={(event) => setDraft({ ...draft, shortcut: event.target.value.replace(/[\s/]/g, '') })}
                />
              </div>
            </div>
            <div>
              <div className="relative mb-1.5 flex items-center justify-between gap-2">
                <label className="label !mb-0" htmlFor="qr-body">Isi pesan</label>
                <button
                  type="button"
                  aria-expanded={emojiOpen}
                  onClick={() => setEmojiOpen((open) => !open)}
                  className="quick-reply-chip inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  <Smile size={14} aria-hidden="true" />Emoji
                </button>
                {emojiOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1.5 max-w-[calc(100vw-2rem)] shadow-2xl">
                    <EmojiPicker onSelectEmoji={insertAtCaret} onClose={() => setEmojiOpen(false)} />
                  </div>
                )}
              </div>
              <textarea
                id="qr-body"
                ref={bodyRef}
                rows={6}
                className="field h-auto min-h-32 py-2 leading-relaxed"
                value={draft.body}
                maxLength={QUICK_REPLY_BODY_MAX}
                onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              />
              <p className="mb-1.5 mt-3 text-xs font-medium text-zinc-600">Data otomatis (ketuk untuk menyisipkan)</p>
              <div className="flex flex-wrap gap-2" aria-label="Sisipkan data otomatis">
                {QUICK_REPLY_SUGGESTED_TOKENS.map((token) => (
                  <button key={token} type="button" onClick={() => insertToken(token)} className="quick-reply-chip inline-flex h-8 items-center rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100">
                    {token}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        pending={remove.isPending}
        title="Hapus balas cepat?"
        description={removing ? '"' + removing.title + '" tidak bisa dipakai lagi.' : undefined}
        confirmLabel="Hapus"
      />
    </div>
  );
}

export default QuickRepliesPage;
