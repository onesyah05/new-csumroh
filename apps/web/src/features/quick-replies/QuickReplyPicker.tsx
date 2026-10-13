import { useEffect, useRef } from 'react';
import { cn } from '../../lib/cn';
import type { QuickReply } from './quickRepliesApi';

/**
 * Daftar balas cepat di atas kolom pesan saat CS mengetik "/". Pemilihan lewat keyboard dikendalikan komponen
 * induk (arah atas/bawah, Enter/Tab, Esc); di sini hanya tampilan dan klik/ketuk.
 */
export function QuickReplyPicker({ items, activeIndex, query, onPick, onHover }: {
  items: QuickReply[];
  activeIndex: number;
  query: string;
  onPick(item: QuickReply): void;
  onHover(index: number): void;
}) {
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }); }, [activeIndex]);

  return (
    <div className="absolute inset-x-2.5 bottom-full z-20 mx-auto mb-1.5 max-w-3xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lift sm:inset-x-4">
      {items.length === 0 ? (
        <p className="px-3 py-3 text-xs text-zinc-600">{query ? 'Tidak ada balas cepat yang cocok' : 'Belum ada balas cepat'}</p>
      ) : (
        <ul role="listbox" aria-label="Balas cepat" className="max-h-64 overflow-y-auto py-1">
          {items.map((item, index) => (
            <li
              key={item.id}
              ref={index === activeIndex ? activeRef : undefined}
              role="option"
              aria-selected={index === activeIndex}
              // mousedown (bukan click) agar kolom pesan tidak kehilangan fokus sebelum teks disisipkan.
              onMouseDown={(event) => { event.preventDefault(); onPick(item); }}
              onMouseEnter={() => onHover(index)}
              className={cn('cursor-pointer px-3 py-2', index === activeIndex ? 'bg-zinc-100' : 'hover:bg-zinc-50')}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 truncate text-xs font-semibold text-zinc-900">{item.title}</span>
                {item.shortcut && <span className="shrink-0 rounded bg-zinc-100 px-1.5 text-xs font-medium leading-4 text-zinc-600">/{item.shortcut}</span>}
                {item.scope === 'personal' && <span className="shrink-0 text-xs text-zinc-500">Pribadi</span>}
              </div>
              <p className="mt-0.5 truncate text-xs text-zinc-600">{item.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
