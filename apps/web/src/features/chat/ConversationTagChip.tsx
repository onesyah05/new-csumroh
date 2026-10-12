import { cn } from '../../lib/cn';
import type { ConversationTag, ConversationTagTone } from './conversationTags';

const TONE: Record<ConversationTagTone, string> = {
  urgent: 'bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-300',
  warn: 'bg-amber-200 text-amber-950 ring-1 ring-inset ring-amber-400',
  ok: 'bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-300',
  info: 'bg-zinc-800 text-white ring-1 ring-inset ring-zinc-800',
  pic: 'bg-indigo-100 text-indigo-800 ring-1 ring-inset ring-indigo-300',
  muted: 'bg-zinc-200 text-zinc-700 ring-1 ring-inset ring-zinc-300',
  contact: 'bg-sky-100 text-sky-800 ring-1 ring-inset ring-sky-300',
  qualified: 'bg-teal-100 text-teal-800 ring-1 ring-inset ring-teal-300',
  offer: 'bg-fuchsia-100 text-fuchsia-800 ring-1 ring-inset ring-fuchsia-300',
  objection: 'bg-orange-100 text-orange-800 ring-1 ring-inset ring-orange-300',
  followup: 'bg-lime-100 text-lime-800 ring-1 ring-inset ring-lime-300',
  nurture: 'bg-stone-200 text-stone-700 ring-1 ring-inset ring-stone-300',
  closing: 'bg-purple-100 text-purple-800 ring-1 ring-inset ring-purple-300',
};

/** Tag kondisi lead di baris daftar percakapan; satu baris, tidak membungkus. */
export function ConversationTagChip({ tag, shrinkable }: { tag: ConversationTag; shrinkable?: boolean }) {
  return (
    <span title={tag.title} className={cn('whitespace-nowrap rounded px-1.5 text-xs font-semibold leading-4', shrinkable ? 'min-w-0 truncate' : 'shrink-0', TONE[tag.tone])}>
      {tag.label}
    </span>
  );
}
