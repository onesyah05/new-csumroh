import { memo } from 'react';
import { Check, CheckCheck, Clock, FileText, ImageIcon, MessageSquareText, Mic, Sticker, Users } from 'lucide-react';
import { ProspectAvatar } from '../../components/ui/avatar';
import { cn } from '../../lib/cn';
import { customBadge } from '../custom/customApi';
import { conversationTags, conversationTrip } from './conversationTags';
import { ConversationTagChip } from './ConversationTagChip';
import { CallIcon, activateWithKeyboard, isMissedCall } from './MessageBubble';

/**
 * Avatar kontak = foto profil WhatsApp (lihat ProspectAvatar: tanpa foto tampil siluet, bukan inisial).
 * Grup dan akun resmi WhatsApp tetap memakai ikon.
 */
export function ContactAvatar({
  photoUrl,
  isGroup,
  isWhatsAppOfficial,
  size = 'md',
}: {
  photoUrl?: string | null;
  isGroup?: boolean;
  isWhatsAppOfficial?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const avatarSize = size === 'sm' ? 'sm' : size === 'lg' ? 'xl' : 'lg';
  if (!isGroup && !isWhatsAppOfficial) return <ProspectAvatar photoUrl={photoUrl} size={avatarSize} />;

  const sizeClass = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10';
  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 22 : 18;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-full shadow-2xs select-none text-white',
        sizeClass,
        isWhatsAppOfficial ? 'bg-[#25d366]' : 'bg-[#00a884]'
      )}
    >
      {isWhatsAppOfficial ? <MessageSquareText size={iconSize} /> : <Users size={iconSize} />}
    </span>
  );
}
function formatWaTimestamp(timestampSeconds?: number): string {
  if (!timestampSeconds) return '';
  const date = new Date(timestampSeconds * 1000);
  const now = new Date();

  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
  }

  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  if (isYesterday) return 'Kemarin';

  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 7 && diffDays >= 0) {
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    return days[date.getDay()] ?? '';
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}
/**
 * Satu baris daftar percakapan. Dibungkus memo: mengetik pesan atau pesan masuk di chat lain
 * hanya merender ulang baris yang datanya berubah, bukan seluruh daftar.
 */
export const ConversationRow = memo(function ConversationRow({
  item, active, today, photoUrl, onSelect,
}: {
  item: any;
  active: boolean;
  today: string;
  photoUrl?: string | null;
  onSelect: (id: number) => void;
}) {
  const last = item.messages?.[0];
  const hasUnread = (item.unreadCount ?? 0) > 0;
  const isGroup = Boolean(item.isGroup);
  const tags = conversationTags(item, today, customBadge(item.customRequests?.[0]));
  const trip = conversationTrip(item);

  return (
          <div
            role="button"
            tabIndex={0}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => activateWithKeyboard(event, () => onSelect(item.id))}
            aria-current={active ? 'true' : undefined}
            aria-label={`Percakapan dengan ${item.name}`}
            className={cn(
              'chat-list-row flex min-h-[72px] items-center gap-3 px-3.5 py-2 cursor-pointer transition-colors select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#00a884]',
              active ? 'bg-[#f0f2f5]' : 'hover:bg-[#f5f6f6]'
            )}
          >
            {/* Avatar */}
            <ContactAvatar
              size="lg"
              photoUrl={photoUrl}
              isGroup={isGroup}
              isWhatsAppOfficial={item.remoteJid === '0@s.whatsapp.net' || item.name === 'WhatsApp'}
            />
  
            {/* Content Column */}
            <div className="min-w-0 flex-1 pr-1">
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-[15px] font-semibold text-[#111b21]">
                  {item.name}
                </span>
                <time className={cn(
                  'shrink-0 text-[12px]',
                  hasUnread ? 'font-semibold text-[#00a884]' : 'text-[#667781]'
                )}>
                  {formatWaTimestamp(last?.timestamp)}
                </time>
              </div>
  
              <div className="mt-0.5 flex items-center justify-between gap-1">
                <span className="truncate text-[13px] text-[#667781] flex items-center gap-1">
                  {last?.isFromMe && (
                    last.status === 'pending' ? (
                      <span title="Menunggu" className="shrink-0 flex items-center text-[#8696a0]">
                        <Clock size={12} />
                      </span>
                    ) : last.status === 'sent' ? (
                      <span title="Terkirim" className="shrink-0 flex items-center">
                        <Check size={14} className="text-[#8696a0]" />
                      </span>
                    ) : (
                      <span title={last.status === 'read' ? 'Sudah dibaca' : 'Tersampaikan'} className="shrink-0 flex items-center">
                        <CheckCheck
                          size={15}
                          className={last.status === 'read' ? 'text-[#53bdeb]' : 'text-[#8696a0]'}
                        />
                      </span>
                    )
                  )}
                  {last?.messageType === 'imageMessage' ? (
                    <span className="inline-flex items-center gap-1"><ImageIcon size={13} /> Foto</span>
                  ) : last?.messageType === 'documentMessage' ? (
                    <span className="inline-flex items-center gap-1"><FileText size={13} /> Dokumen</span>
                  ) : last?.messageType === 'audioMessage' ? (
                    <span className="inline-flex items-center gap-1"><Mic size={13} /> Pesan suara</span>
                  ) : last?.messageType === 'stickerMessage' ? (
                    <span className="inline-flex items-center gap-1"><Sticker size={13} /> Stiker</span>
                  ) : last?.messageType === 'callLogMessage' ? (
                    <span className={cn('inline-flex min-w-0 items-center gap-1', isMissedCall(last.messageText) && 'text-red-600')}>
                      <CallIcon text={last.messageText} size={13} /> <span className="truncate">{last.messageText}</span>
                    </span>
                  ) : (
                    <span className="truncate">{last?.messageText || 'Belum ada pesan'}</span>
                  )}
                </span>
  
                {hasUnread && (
                  <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#25d366] px-1.5 text-xs font-bold text-white shadow-2xs animate-fade-in">
                    {item.unreadCount}
                  </span>
                )}
              </div>
              {(tags.length > 0 || trip) && (
                <div className="mt-1 flex min-w-0 items-center gap-1 overflow-hidden">
                  {tags.map((tag) => <ConversationTagChip key={tag.key} tag={tag} />)}
                  {trip && <ConversationTagChip tag={{ key: 'trip', label: trip.label, tone: 'muted', title: trip.title }} shrinkable />}
                </div>
              )}
            </div>
          </div>
  );
});
