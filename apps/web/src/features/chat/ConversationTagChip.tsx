import { cn } from '../../lib/cn';
import type { ConversationTag, ConversationTagTone } from './conversationTags';

const TONE: Record<ConversationTagTone, string> = {
  urgent: 'bg-rose-50 text-rose-700',
  warn: 'bg-amber-100 text-amber-900',
  ok: 'bg-emerald-50 text-emerald-800',
  info: 'border border-zinc-300 text-zinc-700',
  muted: 'bg-zinc-100 text-zinc-600',
};

/** Tag kondisi lead di baris daftar percakapan; satu baris, tidak membungkus. */
export function ConversationTagChip({ tag, shrinkable }: { tag: ConversationTag; shrinkable?: boolean }) {
  return (
    <span title={tag.title} className={cn('whitespace-nowrap rounded px-1.5 text-[11px] font-semibold leading-4', shrinkable ? 'min-w-0 truncate' : 'shrink-0', TONE[tag.tone])}>
      {tag.label}
    </span>
  );
}
