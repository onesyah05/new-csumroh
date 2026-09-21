import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { Clock3, ContactRound, MapPin, MessageCircleMore, Phone, Plus, Search, UserRound, Users, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useBrandScope } from '../../lib/scope';
import { useAuth } from '../../app/auth';
import { queryClient } from '../../app/query';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { PageError, PageLoading, SectionEmpty } from '../../components/ui/page-feedback';

type Contact = {
  id: number;
  name: string;
  phone: string | null;
  city: string | null;
  leadSource: string;
  status: string;
  remoteJid: string | null;
  messageCount: number;
  user?: { id: number; name: string } | null;
  messages: Array<{ messageText: string | null; messageType: string; timestamp: number; isFromMe: boolean }>;
};

export function ContactsPage() {
  const { user } = useAuth();
  const { brandId, query } = useBrandScope();
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const contacts = useQuery({ queryKey: ['contacts', brandId], queryFn: () => api.get<Contact[]>(`/contacts${query}`), enabled: Boolean(brandId) });
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return contacts.data ?? [];
    return (contacts.data ?? []).filter((contact) => `${contact.name} ${contact.phone ?? ''} ${contact.city ?? ''}`.toLowerCase().includes(needle));
  }, [contacts.data, search]);
  const canAdd = user?.role === 'admin' || user?.role === 'superadmin';

  if (!brandId) return <PageError title="Belum ada brand aktif" description="Pilih brand untuk melihat daftar kontak WhatsApp." />;
  if (contacts.isLoading) return <PageLoading label="Memuat daftar kontak" />;
  if (contacts.isError) return <PageError description={contacts.error.message} onRetry={() => void contacts.refetch()} />;

  return <div className="app-page">
    <section className="page-header">
      <div><p className="page-kicker"><ContactRound size={14} />Kontak jamaah</p><h2 className="page-title">Daftar kontak</h2><p className="page-subtitle">Kontak hasil sinkronisasi WhatsApp dan kontak yang ditambahkan manual oleh Admin Brand.</p></div>
      {canAdd && <Button onClick={() => setDialogOpen(true)}><Plus size={16} />Tambah kontak</Button>}
    </section>

    <section className="grid gap-3 sm:grid-cols-3">
      <Summary icon={Users} value={contacts.data?.length ?? 0} label="Total kontak" />
      <Summary icon={MessageCircleMore} value={contacts.data?.filter((item) => item.messageCount > 0).length ?? 0} label="Punya riwayat chat" />
      <Summary icon={UserRound} value={contacts.data?.filter((item) => item.leadSource === 'manual').length ?? 0} label="Ditambahkan manual" />
    </section>

    <section className="surface overflow-hidden">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm"><Search className="absolute left-3 top-3 text-zinc-400" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} className="field pl-10" placeholder="Cari nama, nomor, atau kota…" /></div>
        <p className="text-xs text-zinc-400">{filtered.length} kontak ditampilkan</p>
      </div>
      {filtered.length ? <div className="grid gap-px bg-zinc-200 md:grid-cols-2 xl:grid-cols-3">{filtered.map((contact) => <ContactCard key={contact.id} contact={contact} />)}</div> : <div className="p-6"><SectionEmpty title="Kontak tidak ditemukan" description={search ? 'Coba gunakan kata pencarian lain.' : 'Kontak WhatsApp yang tersinkron akan muncul di halaman ini.'} /></div>}
    </section>

    <AddContactDialog open={dialogOpen} onOpenChange={setDialogOpen} brandId={brandId} superadmin={user?.role === 'superadmin'} />
  </div>;
}

function ContactCard({ contact }: { contact: Contact }) {
  const latest = contact.messages[0];
  const inboxUrl = `/inbox?prospectId=${contact.id}&phone=${encodeURIComponent(contact.phone ?? '')}&jid=${encodeURIComponent(contact.remoteJid ?? '')}`;
  return <article className="flex min-h-56 flex-col bg-white p-5">
    <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-zinc-100 text-xs font-extrabold">{contact.name.slice(0, 2).toUpperCase()}</span><div className="min-w-0 flex-1"><h3 className="truncate font-display text-sm font-extrabold">{contact.name}</h3><p className="mt-1 flex items-center gap-1 text-xs text-zinc-500"><Phone size={12} />{contact.phone || 'Nomor belum tersedia'}</p></div><Badge value={contact.status} className="shrink-0 text-[8px]" /></div>
    <div className="mt-4 space-y-2 border-y py-3 text-xs text-zinc-500"><p className="flex items-center gap-2"><MapPin size={14} />{contact.city || 'Kota belum diisi'}</p><p className="flex items-center gap-2"><UserRound size={14} />{contact.user?.name || 'Belum ada PIC'}</p><p className="flex items-center gap-2"><Clock3 size={14} />{contact.messageCount} pesan tersimpan</p></div>
    <p className="mt-3 line-clamp-2 min-h-10 text-xs leading-5 text-zinc-500">{latest ? `${latest.isFromMe ? 'Anda: ' : ''}${latest.messageText || `[${latest.messageType}]`}` : 'Belum ada riwayat pesan.'}</p>
    <div className="mt-auto flex items-center justify-between gap-3 pt-4"><span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-zinc-500">{contact.leadSource === 'manual' ? 'Manual' : 'WhatsApp'}</span><Link to={inboxUrl}><Button size="sm"><MessageCircleMore size={14} />Buka chat</Button></Link></div>
  </article>;
}

function AddContactDialog({ open, onOpenChange, brandId, superadmin }: { open: boolean; onOpenChange(open: boolean): void; brandId: number; superadmin: boolean }) {
  const [form, setForm] = useState({ name: '', phone: '', city: '' });
  const create = useMutation({
    mutationFn: () => api.post<Contact>('/contacts', { ...form, ...(superadmin ? { brandId } : {}) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contacts'] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      setForm({ name: '', phone: '', city: '' });
      onOpenChange(false);
    },
  });
  function submit(event: FormEvent) { event.preventDefault(); create.mutate(); }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-white p-6 shadow-lift"><div className="flex items-start justify-between"><div><Dialog.Title className="font-display text-xl font-extrabold">Tambah kontak</Dialog.Title><Dialog.Description className="mt-1 text-sm leading-6 text-zinc-500">Kontak akan masuk ke brand aktif dan dapat langsung dibuka melalui Kotak Masuk.</Dialog.Description></div><Dialog.Close className="rounded-lg p-2 hover:bg-zinc-100"><X size={18} /></Dialog.Close></div><form onSubmit={submit} className="mt-6 space-y-4"><Field label="Nama kontak"><input className="field" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></Field><Field label="Nomor WhatsApp"><input className="field" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Contoh: 081234567890" required /></Field><Field label="Kota (opsional)"><input className="field" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></Field>{create.error && <p className="rounded-xl bg-zinc-100 p-3 text-xs text-zinc-600">{create.error.message}</p>}<div className="flex justify-end gap-2 pt-2"><Dialog.Close asChild><Button type="button" variant="secondary">Batal</Button></Dialog.Close><Button disabled={create.isPending}>{create.isPending ? 'Menyimpan…' : 'Simpan kontak'}</Button></div></form></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="label">{label}</span>{children}</label>; }
function Summary({ icon: Icon, value, label }: { icon: typeof Users; value: number; label: string }) { return <article className="surface flex items-center gap-4 p-5"><span className="grid h-11 w-11 place-items-center rounded-xl bg-zinc-100"><Icon size={20} /></span><div><p className="font-display text-2xl font-extrabold">{value}</p><p className="text-xs text-zinc-400">{label}</p></div></article>; }
