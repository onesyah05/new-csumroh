import { useState } from 'react';
import {
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { ChatProspectProfile } from './ChatProspectProfile';
import { ChatCopilotPanel } from './ChatCopilotPanel';

export type ChatSidePanelTab = 'profile' | 'copilot';

interface ChatSidePanelProps {
  isOpen: boolean;
  activeTab: ChatSidePanelTab;
  onChangeTab: (tab: ChatSidePanelTab) => void;
  onClose: () => void;
  prospectId: number;
  prospectName?: string;
  phone?: string | null;
  packageId?: number | null;
  packageName?: string;
  brandId?: number;
  query?: string;
  activeBrand?: any;
  packages: any[];
  onInsertText: (text: string) => void;
  onSendFlyer: (pkg: any) => void;
  onOpenPackagePicker: () => void;
  onPreviewImage?: (url: string) => void;
  onShowToast: (msg: string) => void;
}

export function ChatSidePanel({
  isOpen,
  activeTab,
  onChangeTab,
  onClose,
  prospectId,
  prospectName,
  phone,
  packageId,
  packageName,
  brandId,
  query = '',
  activeBrand,
  packages,
  onInsertText,
  onSendFlyer,
  onOpenPackagePicker,
  onPreviewImage,
  onShowToast,
}: ChatSidePanelProps) {
  if (!isOpen) return null;

  return (
    <aside
      className={cn(
        'inbox-copilot flex flex-col border-l border-[#e9edef] bg-white h-full',
        isOpen && 'is-open'
      )}
    >
      {/* Side Panel Header with Tabs & Close Button */}
      <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#e9edef] bg-[#f0f2f5] px-3">
        {/* Tab Switchers */}
        <div className="flex items-center gap-1 rounded-xl bg-[#e9edef] p-1 text-xs">
          <button
            type="button"
            onClick={() => onChangeTab('profile')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition cursor-pointer select-none',
              activeTab === 'profile'
                ? 'bg-white text-zinc-900 shadow-2xs'
                : 'text-zinc-600 hover:text-zinc-900'
            )}
          >
            <User size={14} className={activeTab === 'profile' ? 'text-[#00a884]' : 'text-zinc-500'} />
            <span>Profil Prospek</span>
          </button>

          <button
            type="button"
            onClick={() => onChangeTab('copilot')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition cursor-pointer select-none',
              activeTab === 'copilot'
                ? 'bg-white text-zinc-900 shadow-2xs'
                : 'text-zinc-600 hover:text-zinc-900'
            )}
          >
            <Sparkles size={14} className={activeTab === 'copilot' ? 'text-amber-500' : 'text-zinc-500'} />
            <span>Copilot Script</span>
          </button>
        </div>

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 text-zinc-500 hover:bg-black/5 hover:text-zinc-800 transition cursor-pointer"
          title="Tutup Panel Kanan"
          aria-label="Tutup Panel Kanan"
        >
          <X size={18} />
        </button>
      </div>

      {/* Side Panel Body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'profile' ? (
          <ChatProspectProfile
            prospectId={prospectId}
            brandId={brandId}
            query={query}
            activeBrand={activeBrand}
            packages={packages}
            onInsertText={onInsertText}
            onSendFlyer={onSendFlyer}
            onOpenPackagePicker={onOpenPackagePicker}
            onPreviewImage={onPreviewImage}
            onShowToast={onShowToast}
          />
        ) : (
          <ChatCopilotPanel
            prospectName={prospectName}
            packageId={packageId}
            packageName={packageName}
            brandId={brandId}
            query={query}
            onInsertText={onInsertText}
            onShowToast={onShowToast}
          />
        )}
      </div>
    </aside>
  );
}
