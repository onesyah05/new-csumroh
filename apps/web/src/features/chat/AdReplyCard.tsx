import { Megaphone } from 'lucide-react';
import { resolveMediaUrl } from '../../lib/api';
import { cn } from '../../lib/cn';

export type AdPreview = {
  adId: string | null;
  title: string | null;
  body: string | null;
  adName: string | null;
  thumbnailUrl: string | null;
  sourceUrl: string | null;
};

/** Kartu "Ad" di atas pesan pertama dari klik iklan Click-to-WhatsApp, seperti pratinjau iklan di WhatsApp. */
export function AdReplyCard({ ad, isFromMe }: { ad: AdPreview; isFromMe?: boolean }) {
  const title = ad.title || ad.adName || 'Iklan';
  const subtitle = ad.adName && ad.adName !== title ? ad.adName : ad.body;
  return (
    <div
      className={cn('mb-1.5 flex max-w-[300px] items-center gap-2.5 rounded-lg p-1.5 pr-3', isFromMe ? 'bg-black/[0.05]' : 'bg-[#f0f2f5]')}
      title={[title, ad.adId && `Ad ${ad.adId}`].filter(Boolean).join(' · ')}
    >
      {ad.thumbnailUrl ? (
        <img src={resolveMediaUrl(ad.thumbnailUrl)} alt="" loading="lazy" className="size-12 shrink-0 rounded-md bg-zinc-200 object-cover" />
      ) : (
        <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-zinc-200 text-zinc-500">
          <Megaphone size={18} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-[#008069]">Ad</span>
        <span className="block truncate text-[13px] font-semibold text-[#111b21]">{title}</span>
        {subtitle && <span className="block truncate text-xs text-[#667781]">{subtitle}</span>}
      </span>
    </div>
  );
}
