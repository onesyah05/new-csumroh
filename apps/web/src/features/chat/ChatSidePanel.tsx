import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { Sparkles, User, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../app/auth';
import { Button } from '../../components/ui/button';
import { ChatProspectProfile } from './ChatProspectProfile';
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
  useEffect(() => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const media = window.matchMedia('(max-width: 1279px)');
    const update = () => setOverlay(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const { data: prospect } = useQuery({ queryKey: ['prospect', props.prospectId, props.brandId], queryFn: () => api.get<any>(`/prospects/${props.prospectId}${props.query || ''}`), enabled: !!props.brandId });
  const identity = `${user?.id}:${props.brandId}:${props.prospectId}`;
  function insert(text: string) { inserted.current = true; props.onInsertText(text); if (overlay) props.onClose(); }
  const content = <aside className="inbox-copilot is-open sales-panel flex h-full min-h-0 flex-col border-l border-zinc-200 bg-white" aria-label="Profil dan Copilot" style={overlay ? { position: 'fixed', height: '100dvh' } : undefined}>
    {overlay && <Dialog.Title className="sr-only">Profil dan Copilot</Dialog.Title>}
    <header className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 p-3">
      <div role="group" aria-label="Panel percakapan" className="flex min-w-0 gap-1 rounded-xl bg-zinc-100 p-1">
        <Button size="sm" variant={props.activeTab === 'profile' ? 'secondary' : 'ghost'} aria-pressed={props.activeTab === 'profile'} icon={<User size={14} />} onClick={() => props.onChangeTab('profile')}>Profil</Button>
        <Button size="sm" variant={props.activeTab === 'copilot' ? 'secondary' : 'ghost'} aria-pressed={props.activeTab === 'copilot'} icon={<Sparkles size={14} />} onClick={() => props.onChangeTab('copilot')}>Copilot</Button>
      </div>
      <Button size="icon" variant="ghost" aria-label="Tutup panel" onClick={props.onClose}><X size={16} /></Button>
    </header>
    <div key={identity} className="min-h-0 flex-1">
      <div className={props.activeTab === 'profile' ? 'h-full' : 'hidden'}><ChatProspectProfile {...props} onInsertText={insert} onOpenCopilot={() => props.onChangeTab('copilot')} /></div>
      <div className={props.activeTab === 'copilot' ? 'h-full' : 'hidden'}><ChatCopilotPanel prospectName={prospect?.name || props.prospectName} packageId={prospect?.packageId ?? props.packageId} packageName={props.packages.find(pkg => pkg.id === prospect?.packageId)?.name || props.packageName} brandName={props.activeBrand?.name} brandId={props.brandId} query={props.query} stage={prospect?.status} objection={prospect?.objectionNotes} onInsertText={insert} onShowToast={props.onShowToast} /></div>
    </div>
  </aside>;
  if (!props.isOpen) return null;
  if (!overlay) return content;
  return <Dialog.Root open={props.isOpen} onOpenChange={open => { if (!open) props.onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-30 bg-black/25" /><Dialog.Content asChild aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); if (!inserted.current) trigger.current?.focus(); }}>{content}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
