import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, ArrowLeft, X } from 'lucide-react';
import { businessDateKey, dateOnlyKey, isLostStatus, isWonStatus, qualificationMissing } from '@csumroh/shared-types';
import { api } from '../../lib/api';
import { useAuth } from '../../app/auth';
import { Button } from '../../components/ui/button';
import { ChatProspectProfile, type ProfileTab } from './ChatProspectProfile';
import { cn } from '../../lib/cn';
import { ChatCopilotPanel } from './ChatCopilotPanel';
export type ChatSidePanelTab = 'profile' | 'copilot';
interface ChatSidePanelProps {
  isOpen: boolean; activeTab: ChatSidePanelTab; onChangeTab(tab: ChatSidePanelTab): void; onClose(): void;
  prospectId: number; prospectName?: string; phone?: string | null; packageId?: number | null;
  packageName?: string; brandId?: number; query?: string; activeBrand?: any; packages: any[];
  onInsertText(text: string): void; onSendFlyer(pkg: any): void; onOpenPackagePicker(): void;
  onPreviewImage?(url: string): void; onShowToast(message: string): void; connected?: boolean;
}
export function ChatSidePanel(props: ChatSidePanelProps) {
  const { user } = useAuth();
  const [overlay, setOverlay] = useState(() => window.matchMedia('(max-width: 1279px)').matches);
  const trigger = useRef<HTMLElement | null>(null);
  const inserted = useRef(false);
  const [profileTab, setProfileTab] = useState<ProfileTab>('package');
  useEffect(() => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const media = window.matchMedia('(max-width: 1279px)');
    const update = () => setOverlay(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const { data: prospect } = useQuery({ queryKey: ['prospect', props.prospectId, props.brandId], queryFn: () => api.get<any>(`/prospects/${props.prospectId}${props.query || ''}`), enabled: !!props.brandId });
  const identity = `${user?.id}:${props.brandId}:${props.prospectId}`;
  const tabs = [
    { id: 'package', label: 'Paket' },
    { id: 'qualification', label: 'Kualifikasi' },
    { id: 'notes', label: 'Catatan' },
    { id: 'copilot', label: 'Copilot' },
    { id: 'history', label: 'Riwayat' },
  ] as const;
  const current = props.activeTab === 'copilot' ? 'copilot' : profileTab;
  const qualificationIncomplete = Boolean(prospect) && qualificationMissing(prospect).length > 0;
  const followupKey = dateOnlyKey(prospect?.nextFollowupDate);
  const followupLate = Boolean(followupKey && followupKey < businessDateKey() && !isWonStatus(prospect?.status) && !isLostStatus(prospect?.status));
  function select(tab: (typeof tabs)[number]['id']) {
    if (tab === 'copilot') return props.onChangeTab('copilot');
    setProfileTab(tab);
    props.onChangeTab('profile');
  }
  function insert(text: string) { inserted.current = true; props.onInsertText(text); if (overlay) props.onClose(); }
  const content = <aside className="inbox-copilot is-open sales-panel flex h-full min-h-0 flex-col border-l border-zinc-200 bg-white" aria-label="Profil dan Copilot" style={overlay ? { position: 'fixed', height: '100dvh' } : undefined}>
    {overlay && <Dialog.Title className="sr-only">Profil dan Copilot</Dialog.Title>}
    <div className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-3 py-2 md:hidden">
      <Button variant="ghost" size="icon" aria-label="Kembali ke percakapan" onClick={props.onClose}><ArrowLeft size={20} /></Button>
      <div className="min-w-0"><p className="truncate text-sm font-semibold">{prospect?.name || props.prospectName}</p><p className="truncate text-xs text-zinc-600">{props.activeBrand?.name} · {props.activeTab === 'copilot' ? 'Copilot' : 'Profil prospek'}</p></div>
    </div>
    {/* Satu baris tab: identitas jamaah sudah ada di header chat, jadi panel langsung ke pekerjaan. */}
    <header className="flex min-h-12 shrink-0 items-stretch border-b border-zinc-200 pl-1 pr-1">
      <div role="tablist" aria-label="Panel percakapan" className="thin-scrollbar flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={current === tab.id}
            onClick={() => select(tab.id)}
            className={cn(
              '-mb-px inline-flex shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-2 pb-2.5 pt-3 text-xs font-semibold transition',
              current === tab.id ? 'border-zinc-950 text-zinc-950' : 'border-transparent text-zinc-500 hover:text-zinc-900',
            )}
          >
            {tab.label}
            {tab.id === 'qualification' && qualificationIncomplete && (
              <><AlertCircle size={12} className="text-amber-600" aria-hidden="true" /><span className="sr-only">(belum lengkap)</span></>
            )}
            {tab.id === 'notes' && followupLate && (
              <><AlertCircle size={12} className="text-amber-600" aria-hidden="true" /><span className="sr-only">(follow-up terlambat)</span></>
            )}
          </button>
        ))}
      </div>
      <Button size="icon" variant="ghost" aria-label="Tutup panel" onClick={props.onClose} className="hidden shrink-0 self-center md:inline-flex"><X size={16} /></Button>
    </header>
    <div key={identity} className="min-h-0 flex-1">
      <div className={props.activeTab === 'profile' ? 'h-full' : 'hidden'}><ChatProspectProfile {...props} activeTab={profileTab} onChangeTab={setProfileTab} onInsertText={insert} onOpenCopilot={() => props.onChangeTab('copilot')} /></div>
      <div className={props.activeTab === 'copilot' ? 'h-full' : 'hidden'}><ChatCopilotPanel prospectId={props.prospectId} revision={prospect?.updatedAt} prospectName={prospect?.name || props.prospectName} packageId={prospect?.packageId ?? props.packageId} packageName={props.packages.find(pkg => pkg.id === prospect?.packageId)?.name || props.packageName} brandName={props.activeBrand?.name} brandId={props.brandId} query={props.query} stage={prospect?.status} objectionCategory={prospect?.objectionCategory} objection={prospect?.objectionNotes} onInsertText={insert} onShowToast={props.onShowToast} /></div>
    </div>
  </aside>;
  if (!props.isOpen) return null;
  if (!overlay) return content;
  return <Dialog.Root open={props.isOpen} onOpenChange={open => { if (!open) props.onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-30 bg-black/25" /><Dialog.Content asChild aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); if (!inserted.current) trigger.current?.focus(); else requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-chat-composer]')?.focus()); }}>{content}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
