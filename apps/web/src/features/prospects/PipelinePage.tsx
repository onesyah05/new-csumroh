import { useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowUpRight, CalendarClock, Download, GripVertical, KanbanSquare, List, MoreHorizontal, Plus, Search, UserPlus2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { canTransitionStatus, pipelineStatuses, type ProspectStatus } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { useBrandScope } from '../../lib/scope';
import { queryClient } from '../../app/query';
import { useAuth } from '../../app/auth';
import { Badge, statusLabels } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { PageError, PageLoading } from '../../components/ui/page-feedback';
import { cn } from '../../lib/cn';

const money = (value: unknown) => new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value ?? 0));
const columns = pipelineStatuses.map((id, index) => ({ id, number: index + 1, label: statusLabels[id] }));

export function PipelinePage() {
  const { user } = useAuth(); const { brandId, query } = useBrandScope(); const [view, setView] = useState<'kanban'|'table'>('kanban'); const [search, setSearch] = useState(''); const [quick, setQuick] = useState('all'); const [dialogOpen, setDialogOpen] = useState(false); const [draggedId,setDraggedId]=useState<number|null>(null); const [dragOverStatus,setDragOverStatus]=useState<ProspectStatus|null>(null); const [moveAnnouncement,setMoveAnnouncement]=useState('');
  const prospects = useQuery({ queryKey: ['prospects', brandId], queryFn: () => api.get<any[]>(`/prospects${query}`), enabled: !!brandId });
  const filtered = useMemo(() => (prospects.data ?? []).filter((p) => { const text = `${p.name} ${p.phone ?? ''} ${p.city ?? ''}`.toLowerCase(); if (!text.includes(search.toLowerCase())) return false; if (quick === 'hot') return ['offered','closing'].includes(p.status); if (quick === 'won') return p.status === 'closed_won'; if (quick === 'new') return p.status === 'new'; if (quick === 'today') return p.nextFollowupDate && new Date(p.nextFollowupDate).toDateString() === new Date().toDateString(); return true; }), [prospects.data, search, quick]);
  const updateStatus = useMutation({
    mutationFn: ({ id,status }: { id:number; status:string }) => api.patch(`/prospects/${id}/status`, { status, ...(user?.role === 'superadmin' ? { brandId } : {}) }),
    onMutate: async ({id,status}) => {
      const queryKey=['prospects',brandId] as const;
      await queryClient.cancelQueries({queryKey});
      const previous=queryClient.getQueryData<any[]>(queryKey);
      queryClient.setQueryData<any[]>(queryKey,(current)=>current?.map((item)=>item.id===id?{...item,status}:item));
      return {previous,queryKey};
    },
    onError: (_error,_variables,context) => {
      if(context?.previous)queryClient.setQueryData(context.queryKey,context.previous);
    },
    onSuccess: (_data,{id,status}) => {
      const moved=(prospects.data??[]).find((item)=>item.id===id);
      setMoveAnnouncement(`${moved?.name??'Prospek'} dipindahkan ke ${statusLabels[status]??status}.`);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['prospects'] }),
  });
  const claim = useMutation({ mutationFn: (id: number) => api.post(`/prospects/${id}/claim`), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['prospects'] }) });
  function exportCsv() { const rows = [['Nama','WhatsApp','Kota','Status','PIC','Nilai'], ...filtered.map((p) => [p.name,p.phone,p.city,p.status,p.user?.name ?? '',p.dealValue])]; const blob = new Blob([rows.map((r) => r.map((v) => `"${String(v ?? '').replaceAll('"','""')}"`).join(',')).join('\n')], { type: 'text/csv' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'pipeline-csumroh.csv'; link.click(); URL.revokeObjectURL(link.href); }
  function startDrag(event:DragEvent<HTMLElement>,prospect:any){
    if(updateStatus.isPending){event.preventDefault();return;}
    event.dataTransfer.effectAllowed='move';
    event.dataTransfer.setData('text/plain',String(prospect.id));
    setDraggedId(prospect.id);
    setMoveAnnouncement(`Memindahkan ${prospect.name}. Pilih kolom tujuan.`);
  }
  function allowDrop(event:DragEvent<HTMLElement>,target:ProspectStatus){
    const dragged=(prospects.data??[]).find((item)=>item.id===draggedId);
    if(!dragged||dragged.status===target||!canTransitionStatus(dragged.status as ProspectStatus,target))return;
    event.preventDefault();
    event.dataTransfer.dropEffect='move';
    setDragOverStatus(target);
  }
  function dropCard(event:DragEvent<HTMLElement>,target:ProspectStatus){
    event.preventDefault();
    const id=Number(event.dataTransfer.getData('text/plain')||draggedId);
    const dragged=(prospects.data??[]).find((item)=>item.id===id);
    setDraggedId(null);setDragOverStatus(null);
    if(!dragged||dragged.status===target)return;
    if(!canTransitionStatus(dragged.status as ProspectStatus,target)){
      setMoveAnnouncement(`Perpindahan dari ${statusLabels[dragged.status]??dragged.status} ke ${statusLabels[target]} tidak diizinkan.`);
      return;
    }
    updateStatus.mutate({id,status:target});
  }
  function endDrag(){setDraggedId(null);setDragOverStatus(null);}
  if (!brandId) return <PageError title="Belum ada brand aktif" description="Buat brand melalui menu Administrasi agar pipeline dapat memakai data prospek sebenarnya." />;
  if (prospects.isLoading) return <PageLoading label="Memuat pipeline" />;
  if (prospects.isError) return <PageError description={prospects.error.message} onRetry={() => void prospects.refetch()} />;
  return <div className="app-page">
    <section className="page-header"><div><p className="page-kicker">Conversion pipeline</p><h2 className="page-title">Prospek jamaah</h2><p className="page-subtitle">Kelola perjalanan setiap calon jamaah dari sapaan pertama hingga deal.</p></div><div className="flex flex-wrap gap-2"><div className="flex rounded-xl border bg-white p-1" role="group" aria-label="Tampilan pipeline"><button aria-pressed={view === 'kanban'} onClick={() => setView('kanban')} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${view === 'kanban' ? 'bg-zinc-950 text-white' : 'text-zinc-500'}`}><KanbanSquare size={14} />Board</button><button aria-pressed={view === 'table'} onClick={() => setView('table')} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${view === 'table' ? 'bg-zinc-950 text-white' : 'text-zinc-500'}`}><List size={14} />Tabel</button></div><Button variant="secondary" onClick={exportCsv}><Download size={15} />Ekspor</Button><Button onClick={() => setDialogOpen(true)}><Plus size={16} />Prospek baru</Button></div></section>
    <section className="surface flex flex-col gap-3 p-3 xl:flex-row xl:items-center"><div className="relative min-w-64 flex-1"><Search size={15} className="absolute left-3 top-3 text-zinc-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 w-full rounded-xl border bg-zinc-50 pl-9 pr-3 text-sm" placeholder="Cari nama, nomor, atau kota…" /></div><div className="thin-scrollbar flex gap-1.5 overflow-x-auto">{([['all','Semua'],['hot','High intent'],['today','Follow-up hari ini'],['won','Closed won'],['new','Baru']] as const).map(([id,label]) => <button key={id} onClick={() => setQuick(id)} className={`whitespace-nowrap rounded-full px-3 py-2 text-xs font-semibold transition ${quick === id ? 'bg-zinc-950 text-white' : 'border bg-white text-zinc-500 hover:bg-zinc-100'}`}>{label}</button>)}</div></section>
    {view==='kanban'&&<div className="flex items-center justify-between gap-3"><p className="flex items-center gap-1.5 text-xs text-zinc-400"><GripVertical size={14}/>Tarik kartu ke kolom tujuan untuk mengubah status.</p><p className="sr-only" aria-live="polite">{moveAnnouncement}</p></div>}
    {updateStatus.error && <p className="rounded-xl border bg-zinc-100 p-3 text-sm text-zinc-600">{updateStatus.error.message}</p>}
    {view === 'kanban' ? <div className="thin-scrollbar -mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"><div className="flex min-w-max gap-3">{columns.map((column) => { const items = filtered.filter((p) => p.status === column.id); const dragged=(prospects.data??[]).find((item)=>item.id===draggedId); const canDrop=!!dragged&&dragged.status!==column.id&&canTransitionStatus(dragged.status as ProspectStatus,column.id); return <section key={column.id} aria-label={`Kolom ${column.label}`} onDragOver={(event)=>allowDrop(event,column.id)} onDragEnter={(event)=>allowDrop(event,column.id)} onDragLeave={(event)=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragOverStatus(null)}} onDrop={(event)=>dropCard(event,column.id)} className={cn('w-[278px] rounded-2xl border bg-zinc-100/70 p-2.5 transition-all',draggedId&&canDrop&&'border-zinc-400 bg-zinc-100',dragOverStatus===column.id&&canDrop&&'scale-[1.01] border-zinc-950 bg-zinc-200/80 ring-2 ring-zinc-950/10',draggedId&&!canDrop&&'opacity-55')}><header className="flex items-center gap-2 px-1.5 pb-3 pt-1"><span className="grid h-6 w-6 place-items-center rounded-lg bg-zinc-950 text-[9px] font-bold text-white">{column.number}</span><h3 className="flex-1 text-xs font-bold">{column.label}</h3><span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-zinc-500">{items.length}</span></header><div className={cn('min-h-28 space-y-2 rounded-xl transition',dragOverStatus===column.id&&canDrop&&'bg-white/50 p-1')}>{items.map((p) => <ProspectCard key={p.id} prospect={p} dragging={draggedId===p.id} disabled={updateStatus.isPending} onDragStart={(event)=>startDrag(event,p)} onDragEnd={endDrag} onStatus={(status) => updateStatus.mutate({ id: p.id, status })} onClaim={() => claim.mutate(p.id)} canClaim={user?.role === 'cs' && !p.user} />)}{!items.length && <div className={cn('rounded-xl border border-dashed border-zinc-300 p-7 text-center text-[11px] text-zinc-400',dragOverStatus===column.id&&canDrop&&'border-zinc-950 text-zinc-700')}>{dragOverStatus===column.id&&canDrop?'Lepaskan kartu di sini':'Belum ada prospek'}</div>}</div></section>; })}</div></div> : <div className="surface overflow-hidden"><div className="thin-scrollbar overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead className="border-b bg-zinc-50 text-[10px] uppercase tracking-[.1em] text-zinc-400"><tr><th className="px-5 py-3">Jamaah</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Paket</th><th className="px-4 py-3">Nilai</th><th className="px-4 py-3">CS PIC</th><th className="px-4 py-3">Follow-up</th><th className="px-5 py-3 text-right">Aksi</th></tr></thead><tbody className="divide-y">{filtered.map((p) => <tr key={p.id} className="text-sm hover:bg-zinc-50"><td className="px-5 py-4"><Link to={`/prospects/${p.id}`} className="font-bold hover:underline">{p.name}</Link><p className="mt-1 text-xs text-zinc-400">{p.phone} · {p.city}</p></td><td className="px-4"><Badge value={p.status} /></td><td className="px-4 text-xs text-zinc-600">{p.package?.name ?? '—'}</td><td className="px-4 font-semibold">Rp {money(p.dealValue)}</td><td className="px-4 text-xs">{p.user?.name ?? <button onClick={() => claim.mutate(p.id)} className="font-bold underline">Klaim PIC</button>}</td><td className="px-4 text-xs text-zinc-500">{p.nextFollowupDate ? new Date(p.nextFollowupDate).toLocaleDateString('id-ID') : '—'}</td><td className="px-5 text-right"><Link to={`/prospects/${p.id}`} aria-label={`Buka profil ${p.name}`}><Button variant="ghost" size="icon"><ArrowUpRight size={16} /></Button></Link></td></tr>)}{!filtered.length && <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-zinc-400">Tidak ada prospek yang cocok dengan filter.</td></tr>}</tbody></table></div></div>}
    <NewProspectDialog open={dialogOpen} onOpenChange={setDialogOpen} brandId={brandId} superadmin={user?.role === 'superadmin'} />
  </div>;
}

function ProspectCard({ prospect, dragging, disabled, onDragStart, onDragEnd, onStatus, onClaim, canClaim }: { prospect:any; dragging:boolean; disabled:boolean; onDragStart(event:DragEvent<HTMLElement>):void; onDragEnd():void; onStatus(status:string):void; onClaim():void; canClaim:boolean }) {
  return <article aria-label={`Kartu prospek ${prospect.name}`} draggable={!disabled} onDragStart={onDragStart} onDragEnd={onDragEnd} className={cn('group cursor-grab rounded-xl border bg-white p-3.5 shadow-sm transition active:cursor-grabbing hover:-translate-y-0.5 hover:shadow-soft',dragging&&'scale-95 opacity-40 ring-2 ring-zinc-950/20',disabled&&'cursor-wait')}><div className="flex items-start justify-between gap-2"><span className="flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-zinc-500"><GripVertical size={11}/>{prospect.leadSource}</span><DropdownMenu.Root><DropdownMenu.Trigger className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100" aria-label={`Aksi ${prospect.name}`}><MoreHorizontal size={16} /></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" className="z-50 w-52 rounded-xl border bg-white p-1 shadow-lift"><p className="px-2 py-1.5 text-[9px] font-bold uppercase tracking-wide text-zinc-400">Pindahkan status</p>{pipelineStatuses.filter((status) => canTransitionStatus(prospect.status as ProspectStatus, status)).map((status) => <DropdownMenu.Item key={status} disabled={status === prospect.status} onSelect={() => onStatus(status)} className="cursor-pointer rounded-lg px-2 py-2 text-xs outline-none hover:bg-zinc-100 disabled:opacity-30">{statusLabels[status]}</DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root></div><Link to={`/prospects/${prospect.id}`} draggable={false}><h4 className="mt-3 font-display text-sm font-bold hover:underline">{prospect.name}</h4><p className="mt-1 text-[11px] text-zinc-400">{prospect.city || prospect.phone || 'Kontak belum lengkap'}</p></Link><div className="my-3 border-t" /><p className="truncate text-[11px] text-zinc-500">{prospect.package?.name ?? 'Paket belum dipilih'}</p><div className="mt-3 flex items-center justify-between"><span className="font-display text-sm font-extrabold">Rp {money(prospect.dealValue)}</span>{canClaim ? <button onClick={onClaim} className="flex items-center gap-1 text-[10px] font-bold underline"><UserPlus2 size={12} />Klaim</button> : <span className="max-w-24 truncate text-[10px] text-zinc-400">{prospect.user?.name ?? 'Tanpa PIC'}</span>}</div>{prospect.nextFollowupDate && <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2 py-1.5 text-[9px] font-semibold text-zinc-500"><CalendarClock size={11} />{new Date(prospect.nextFollowupDate).toLocaleDateString('id-ID',{day:'numeric',month:'short'})}</div>}</article>;
}

function NewProspectDialog({ open,onOpenChange,brandId,superadmin }: { open:boolean; onOpenChange(open:boolean):void; brandId:number|null|undefined; superadmin:boolean }) {
  const [form,setForm] = useState({ name:'',phone:'',city:'',leadSource:'whatsapp' }); const create = useMutation({ mutationFn: () => api.post('/prospects',{...form,...(superadmin?{brandId}: {})}), onSuccess: () => { void queryClient.invalidateQueries({queryKey:['prospects']}); onOpenChange(false); setForm({name:'',phone:'',city:'',leadSource:'whatsapp'}); } });
  function submit(e:FormEvent){e.preventDefault();create.mutate();}
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-white p-6 shadow-lift"><div className="flex items-start justify-between"><div><Dialog.Title className="font-display text-xl font-extrabold">Tambah prospek</Dialog.Title><Dialog.Description className="mt-1 text-sm text-zinc-500">Catat calon jamaah baru ke pipeline.</Dialog.Description></div><Dialog.Close className="rounded-lg p-2 hover:bg-zinc-100"><X size={18}/></Dialog.Close></div><form onSubmit={submit} className="mt-6 space-y-4"><div><label className="label">Nama jamaah</label><input className="field" value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} required /></div><div className="grid grid-cols-2 gap-3"><div><label className="label">WhatsApp</label><input className="field" value={form.phone} onChange={(e)=>setForm({...form,phone:e.target.value})} /></div><div><label className="label">Kota</label><input className="field" value={form.city} onChange={(e)=>setForm({...form,city:e.target.value})} /></div></div><div><label className="label">Sumber lead</label><Select value={form.leadSource} onValueChange={(leadSource)=>setForm({...form,leadSource})} options={([['whatsapp','WhatsApp'],['meta_ads','Meta Ads'],['website','Website'],['referral','Referral'],['walk_in','Walk-in']] as const).map(([value,label])=>({value,label}))} className="w-full" /></div>{create.error&&<p className="text-xs text-zinc-600">{create.error.message}</p>}<div className="flex justify-end gap-2 pt-2"><Dialog.Close asChild><Button type="button" variant="secondary">Batal</Button></Dialog.Close><Button disabled={create.isPending}>{create.isPending?'Menyimpan…':'Simpan prospek'}</Button></div></form></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
