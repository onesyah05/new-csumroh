import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  CornerDownLeft,
  Filter,
  Layers,
  MessageCircle,
  MessageSquareQuote,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  User,
  Wand2,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/button';

const categories = [
  { id: 'greeting', label: 'Sapaan', icon: Sparkles },
  { id: 'identification', label: 'Kualifikasi', icon: User },
  { id: 'offer', label: 'Paket & Solusi', icon: Layers },
  { id: 'objection', label: 'Keberatan (TGJP)', icon: ShieldAlert },
  { id: 'followups', label: 'Follow-up', icon: MessageSquareQuote },
  { id: 'closing', label: 'Closing & DP', icon: Wand2 },
] as const;

const npgdTabs = [
  { id: 'all', label: 'Semua NPGD' },
  { id: 'need', label: 'Need' },
  { id: 'pain', label: 'Pain' },
  { id: 'gain', label: 'Gain' },
  { id: 'dream', label: 'Dream' },
  { id: 'qualification', label: 'Kualifikasi' },
  { id: 'combination', label: 'Kombinasi' },
  { id: 'transition', label: 'Transisi' },
];

function getNpgdBadgeClass(code?: string) {
  switch ((code || '').toLowerCase()) {
    case 'need':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'pain':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'gain':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'dream':
      return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'qualification':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'combination':
      return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'transition':
      return 'bg-teal-50 text-teal-700 border-teal-200';
    default:
      return 'bg-zinc-100 text-zinc-700 border-zinc-200';
  }
}

function getStepBadgeClass(label: string) {
  switch (label.toUpperCase()) {
    case 'T':
      return 'bg-amber-500 text-white';
    case 'G':
      return 'bg-sky-600 text-white';
    case 'J':
      return 'bg-emerald-600 text-white';
    case 'P':
      return 'bg-indigo-600 text-white';
    default:
      return 'bg-zinc-800 text-white';
  }
}

interface ChatCopilotPanelProps {
  prospectName?: string;
  packageId?: number | null;
  packageName?: string;
  brandId?: number;
  query?: string;
  onInsertText: (text: string) => void;
  onShowToast: (msg: string) => void;
}

export function ChatCopilotPanel({
  prospectName = 'Bapak/Ibu',
  packageId,
  packageName,
  brandId,
  query = '',
  onInsertText,
  onShowToast,
}: ChatCopilotPanelProps) {
  const [activeCategory, setActiveCategory] = useState<string>('greeting');
  const [npgdFilter, setNpgdFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  const separator = query ? '&' : '?';
  const scriptsQuery = useQuery({
    queryKey: ['scripts', brandId, prospectName, packageId],
    queryFn: () =>
      api.get<any>(
        `/scripts${query}${separator}nama=${encodeURIComponent(prospectName)}${
          packageId ? `&packageId=${packageId}` : ''
        }`
      ),
    enabled: !!brandId,
    staleTime: 5 * 60 * 1000,
  });

  const categoriesData = scriptsQuery.data?.categories ?? {};
  const currentCategoryObj = categoriesData[activeCategory] ?? {};
  const rawScripts = (currentCategoryObj.scripts ?? []) as any[];

  // Filter scripts based on category, NPGD, and search query
  const filteredScripts = useMemo(() => {
    return rawScripts.filter((item) => {
      if (activeCategory === 'identification' && npgdFilter !== 'all') {
        const itemCat = String(item.category ?? '').toLowerCase();
        const npgdCode = String(item.npgd?.code ?? '').toLowerCase();
        if (itemCat !== npgdFilter && npgdCode !== npgdFilter) return false;
      }
      if (!search.trim()) return true;
      const haystack = `${item.title} ${item.use_when} ${item.script} ${item.npgd?.label ?? ''} ${
        item.steps?.map((s: any) => s.text).join(' ') ?? ''
      }`.toLowerCase();
      return haystack.includes(search.toLowerCase());
    });
  }, [rawScripts, activeCategory, npgdFilter, search]);

  function toggleCardExpanded(key: string) {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleCopy(text: string, key: string) {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    onShowToast('Script disalin ke clipboard');
    setTimeout(() => setCopiedKey(null), 2000);
  }

  function handleInsert(text: string) {
    if (!text) return;
    onInsertText(text);
    onShowToast('Script disisipkan ke percakapan');
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white text-zinc-800">
      {/* Top Search & Filter Bar */}
      <div className="shrink-0 border-b border-zinc-200 bg-[#f0f2f5] p-3 space-y-2.5">
        {/* Search Bar */}
        <div className="relative flex items-center">
          <Search size={14} className="absolute left-3 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari skrip kata kunci, keberatan, sapaan..."
            className="h-8.5 w-full rounded-xl border border-zinc-200 bg-white pl-8.5 pr-8 text-xs text-zinc-800 placeholder:text-zinc-400 outline-none focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884]"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 text-zinc-400 hover:text-zinc-700"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Dynamic Personalization Indicator */}
        <div className="flex items-center gap-1.5 overflow-x-auto thin-scrollbar text-[11px] text-zinc-500">
          <span className="font-semibold text-zinc-400 shrink-0">Variabel:</span>
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800 border border-emerald-200/60 shrink-0">
            👤 {prospectName}
          </span>
          {packageName && (
            <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 font-semibold text-blue-800 border border-blue-200/60 shrink-0 truncate max-w-[150px]">
              🕋 {packageName}
            </span>
          )}
        </div>

        {/* Categories Tab Selector */}
        <div className="flex items-center gap-1 overflow-x-auto thin-scrollbar pb-0.5">
          {categories.map((cat) => {
            const count = (categoriesData[cat.id]?.scripts ?? []).length;
            const isActive = activeCategory === cat.id;
            const Icon = cat.icon;

            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setActiveCategory(cat.id);
                  setNpgdFilter('all');
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap transition cursor-pointer',
                  isActive
                    ? 'bg-[#00a884] text-white shadow-2xs'
                    : 'bg-white text-zinc-600 border border-zinc-200/80 hover:bg-zinc-100'
                )}
              >
                <Icon size={12} className={isActive ? 'text-white' : 'text-zinc-500'} />
                <span>{cat.label}</span>
                {count > 0 && (
                  <span
                    className={cn(
                      'ml-0.5 rounded-full px-1.5 py-0.2 text-[10px] font-bold',
                      isActive ? 'bg-white/20 text-white' : 'bg-zinc-100 text-zinc-500'
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Sub-filter for NPGD (Identification only) */}
        {activeCategory === 'identification' && (
          <div className="flex items-center gap-1 overflow-x-auto thin-scrollbar pt-1">
            <span className="text-[10px] font-bold uppercase text-zinc-400 shrink-0 mr-1">
              Framework:
            </span>
            {npgdTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setNpgdFilter(tab.id)}
                className={cn(
                  'rounded-lg px-2 py-0.5 text-[11px] font-bold whitespace-nowrap transition',
                  npgdFilter === tab.id
                    ? 'bg-zinc-900 text-white'
                    : 'bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-100'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Script List Body */}
      <div className="thin-scrollbar flex-1 overflow-y-auto px-3.5 py-3 space-y-3">
        {scriptsQuery.isLoading ? (
          <div className="flex flex-col items-center justify-center p-8 text-center text-xs text-zinc-400">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#00a884] border-t-transparent mb-3" />
            <span>Menyiapkan skrip copilot cerdas...</span>
          </div>
        ) : filteredScripts.length === 0 ? (
          <div className="py-12 text-center text-xs text-zinc-400">
            <MessageSquareQuote size={28} className="mx-auto text-zinc-300 mb-2" />
            <p className="font-bold text-zinc-600">Tidak ada skrip yang cocok</p>
            <p className="mt-1 text-zinc-400">
              {search ? 'Coba ubah kata kunci pencarian' : 'Belum ada data skrip untuk kategori ini'}
            </p>
          </div>
        ) : (
          filteredScripts.map((item, idx) => {
            const cardKey = `${activeCategory}-${idx}-${item.title}`;
            const isCopied = copiedKey === cardKey;
            const hasSteps = Array.isArray(item.steps) && item.steps.length > 0;
            const isExpanded = expandedCards.has(cardKey);

            return (
              <div
                key={cardKey}
                className="group rounded-2xl border border-zinc-200 bg-white p-3 shadow-2xs hover:border-emerald-300 hover:shadow-xs transition duration-150 space-y-2.5"
              >
                {/* Header: Title & Badges */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h5 className="font-bold text-xs text-zinc-900 leading-tight">
                      {item.title}
                    </h5>
                    {item.use_when && (
                      <p className="mt-1 text-[11px] text-zinc-500 leading-relaxed">
                        <span className="font-semibold text-zinc-600">Saat:</span> {item.use_when}
                      </p>
                    )}
                  </div>

                  {item.npgd && (
                    <span
                      className={cn(
                        'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-extrabold',
                        getNpgdBadgeClass(item.npgd.code)
                      )}
                    >
                      {item.npgd.label}
                    </span>
                  )}
                </div>

                {/* Objection TGJP Steps Preview (if available) */}
                {hasSteps && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center gap-1">
                      {item.steps.map((step: any, sIdx: number) => (
                        <span
                          key={sIdx}
                          className={cn(
                            'grid h-5 w-5 place-items-center rounded-md text-[10px] font-black shadow-2xs',
                            getStepBadgeClass(step.label)
                          )}
                          title={`${step.name}: ${step.text}`}
                        >
                          {step.label}
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={() => toggleCardExpanded(cardKey)}
                        className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-zinc-400 hover:text-zinc-700"
                      >
                        <span>{isExpanded ? 'Sederhanakan' : 'Lihat 4 Langkah'}</span>
                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="rounded-xl bg-zinc-50 p-2 space-y-2 text-xs border border-zinc-200/80 animate-fade-in">
                        {item.steps.map((step: any, sIdx: number) => (
                          <div key={sIdx} className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={cn(
                                  'grid h-4 w-4 place-items-center rounded text-[9px] font-bold',
                                  getStepBadgeClass(step.label)
                                )}
                              >
                                {step.label}
                              </span>
                              <strong className="text-[11px] text-zinc-800">{step.name}</strong>
                            </div>
                            <p className="text-[11px] text-zinc-600 pl-5.5 leading-relaxed whitespace-pre-line">
                              {step.text}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Script Message Bubble Preview */}
                <div className="rounded-xl border border-emerald-200/60 bg-[#d9fdd3]/25 p-2.5 text-xs text-zinc-800 leading-relaxed whitespace-pre-line select-text font-sans">
                  {item.script}
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-zinc-100">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleCopy(item.script, cardKey)}
                    className="h-7 px-2.5 text-[11px] font-semibold text-zinc-600 hover:text-zinc-900 gap-1"
                    title="Salin ke clipboard"
                  >
                    {isCopied ? <Check size={12} className="text-[#00a884]" /> : <Clipboard size={12} />}
                    <span>{isCopied ? 'Tersalin' : 'Salin'}</span>
                  </Button>

                  <Button
                    size="sm"
                    onClick={() => handleInsert(item.script)}
                    className="h-7 px-3 text-[11px] font-bold bg-[#00a884] hover:bg-[#008f6f] text-white shadow-2xs gap-1.5"
                    title="Sisipkan langsung ke kotak obrolan live chat"
                  >
                    <CornerDownLeft size={12} />
                    <span>Sisipkan ke Chat</span>
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
